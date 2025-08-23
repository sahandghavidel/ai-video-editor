'use client';

import { BaserowRow, updateBaserowRow } from '@/lib/baserow-actions';
import { useState, useRef } from 'react';

interface SceneCardProps {
  data: BaserowRow[];
  refreshData?: () => void;
  onDataUpdate?: (updatedData: BaserowRow[]) => void;
}

export default function SceneCard({
  data,
  refreshData,
  onDataUpdate,
}: SceneCardProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<number | null>(null);
  const audioRefs = useRef<Record<number, HTMLAudioElement>>({});

  const handleEditStart = (sceneId: number, currentText: string) => {
    setEditingId(sceneId);
    setEditingText(currentText);
    setIsCanceling(false);
  };

  const handleEditSave = async (sceneId: number) => {
    if (isUpdating || isCanceling) return;

    // Don't save if text is empty
    if (!editingText.trim()) {
      handleEditCancel();
      return;
    }

    // Check if text actually changed
    const originalText = String(
      data.find((scene) => scene.id === sceneId)?.['field_6890'] ||
        data.find((scene) => scene.id === sceneId)?.field_6890 ||
        ''
    );

    console.log('Attempting to save:', {
      sceneId,
      editingText,
      originalText,
      changed: editingText !== originalText,
    });

    // If text hasn't changed, just exit edit mode without API call
    if (editingText === originalText) {
      console.log('Text unchanged, exiting edit mode');
      setEditingId(null);
      setEditingText('');
      return;
    }

    setIsUpdating(true);

    // Optimistic update - immediately update the UI
    const optimisticData = data.map((scene) => {
      if (scene.id === sceneId) {
        return { ...scene, field_6890: editingText };
      }
      return scene;
    });
    onDataUpdate?.(optimisticData);

    try {
      // updateBaserowRow returns the updated row data directly or throws an error
      const updatedRow = await updateBaserowRow(sceneId, {
        field_6890: editingText,
      });

      console.log('Update successful:', updatedRow);
      setEditingId(null);
      setEditingText('');

      // Refresh data from server to ensure consistency
      refreshData?.();
    } catch (error) {
      console.error('Failed to update scene:', error);

      // Revert optimistic update on error
      onDataUpdate?.(data);

      // You could show a user-friendly error message here
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditCancel = () => {
    setIsCanceling(true);
    setEditingId(null);
    setEditingText('');
    setTimeout(() => setIsCanceling(false), 100); // Reset after a short delay
  };

  const handleKeyDown = (e: React.KeyboardEvent, sceneId: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave(sceneId);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const handleAudioPlay = async (sceneId: number, audioUrl: string) => {
    try {
      console.log('Playing audio for scene:', sceneId, 'URL:', audioUrl);

      // Stop any currently playing audio
      if (playingId && audioRefs.current[playingId]) {
        audioRefs.current[playingId].pause();
      }

      // If clicking the same audio that's playing, just pause it
      if (playingId === sceneId) {
        setPlayingId(null);
        return;
      }

      const audio = audioRefs.current[sceneId];
      if (audio) {
        setLoadingAudio(sceneId);

        // Use the URL directly since it's already a complete HTTP URL
        audio.src = audioUrl;

        try {
          await audio.play();
          setPlayingId(sceneId);
          setLoadingAudio(null);
        } catch (error) {
          console.error('Error playing audio:', error);
          setLoadingAudio(null);
        }
      }
    } catch (error) {
      console.error('Error in handleAudioPlay:', error);
      setLoadingAudio(null);
    }
  };

  const handleAudioPause = (sceneId: number) => {
    const audio = audioRefs.current[sceneId];
    if (audio) {
      audio.pause();
      setPlayingId(null);
    }
  };

  if (!data || data.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center min-h-[400px] text-gray-500'>
        <div className='text-6xl mb-4'>📋</div>
        <h3 className='text-xl font-semibold mb-2'>No Data Available</h3>
        <p className='text-center max-w-md'>
          No scenes found in your Baserow table. Add some data to get started!
        </p>
        <div className='mt-6 space-y-2'>
          {refreshData && (
            <button
              onClick={refreshData}
              className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
            >
              Refresh Data
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className='w-full max-w-7xl mx-auto'>
      <div className='flex items-center justify-between mb-6'>
        <div>
          <h2 className='text-2xl font-bold text-gray-800'>Scenes</h2>
          <p className='text-gray-600 mt-1'>
            {data.length} scene{data.length !== 1 ? 's' : ''} found
          </p>
        </div>
        {refreshData && (
          <button
            onClick={refreshData}
            className='px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center space-x-2'
          >
            <svg
              className='w-4 h-4'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
              />
            </svg>
            <span>Refresh</span>
          </button>
        )}
      </div>

      <div className='grid gap-4'>
        {data.map((scene) => (
          <div
            key={scene.id}
            className='bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow duration-200'
          >
            <div className='flex items-center justify-between'>
              {/* Left side - ID and Order */}
              <div className='flex items-center space-x-8'>
                {/* ID */}
                <div>
                  <label className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                    ID
                  </label>
                  <div className='text-2xl font-bold text-blue-600 mt-1'>
                    #{scene.id || 'N/A'}
                  </div>
                </div>

                {/* Order */}
                <div>
                  <label className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                    Order
                  </label>
                  <div className='text-lg font-semibold text-gray-800 mt-1'>
                    {scene.order ? Math.round(Number(scene.order)) : 'Not set'}
                  </div>
                </div>
              </div>

              {/* Right side - Sentence */}
              <div className='flex-1 ml-8'>
                <div className='flex items-center justify-between'>
                  <label className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                    Sentence{' '}
                    {isUpdating && editingId === scene.id && '(Saving...)'}
                  </label>
                  {/* TTS Audio Button */}
                  {typeof scene['field_6891'] === 'string' &&
                    scene['field_6891'] && (
                      <button
                        onClick={() =>
                          handleAudioPlay(
                            scene.id,
                            scene['field_6891'] as string
                          )
                        }
                        disabled={loadingAudio === scene.id}
                        className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          playingId === scene.id
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={
                          playingId === scene.id ? 'Pause audio' : 'Play audio'
                        }
                      >
                        {loadingAudio === scene.id ? (
                          <svg
                            className='animate-spin h-3 w-3'
                            xmlns='http://www.w3.org/2000/svg'
                            fill='none'
                            viewBox='0 0 24 24'
                          >
                            <circle
                              className='opacity-25'
                              cx='12'
                              cy='12'
                              r='10'
                              stroke='currentColor'
                              strokeWidth='4'
                            ></circle>
                            <path
                              className='opacity-75'
                              fill='currentColor'
                              d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                            ></path>
                          </svg>
                        ) : playingId === scene.id ? (
                          <svg
                            className='h-3 w-3'
                            fill='currentColor'
                            viewBox='0 0 20 20'
                          >
                            <path
                              fillRule='evenodd'
                              d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z'
                              clipRule='evenodd'
                            />
                          </svg>
                        ) : (
                          <svg
                            className='h-3 w-3'
                            fill='currentColor'
                            viewBox='0 0 20 20'
                          >
                            <path
                              fillRule='evenodd'
                              d='M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z'
                              clipRule='evenodd'
                            />
                          </svg>
                        )}
                        <span>{playingId === scene.id ? 'Pause' : 'Play'}</span>
                      </button>
                    )}
                </div>
                {editingId === scene.id ? (
                  <div className='mt-1'>
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, scene.id)}
                      onBlur={() => {
                        // Only save on blur if we're not canceling
                        if (!isCanceling) {
                          handleEditSave(scene.id);
                        }
                      }}
                      className='w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none'
                      rows={3}
                      autoFocus
                      disabled={isUpdating}
                      placeholder='Enter sentence...'
                    />
                    <div className='flex justify-end space-x-2 mt-2'>
                      <button
                        onClick={handleEditCancel}
                        className='px-3 py-1 text-xs text-gray-600 hover:text-gray-800'
                        disabled={isUpdating}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEditSave(scene.id)}
                        className='px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50'
                        disabled={isUpdating}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className='text-gray-700 mt-1 leading-relaxed cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors'
                    onClick={() =>
                      handleEditStart(
                        scene.id,
                        String(scene['field_6890'] || scene.field_6890 || '')
                      )
                    }
                    title='Click to edit'
                  >
                    {String(
                      scene['field_6890'] ||
                        scene.field_6890 ||
                        'No sentence - Click to add'
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Hidden audio elements for playback */}
      {data.map((scene) => (
        <audio
          key={`audio-${scene.id}`}
          ref={(el) => {
            if (el) audioRefs.current[scene.id] = el;
          }}
          onEnded={() => handleAudioPause(scene.id)}
          onError={(e) => {
            console.error('Audio error for scene', scene.id, e);
            setLoadingAudio(null);
            setPlayingId(null);
          }}
        />
      ))}
    </div>
  );
}
