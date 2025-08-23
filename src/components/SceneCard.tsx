'use client';

import { BaserowRow, updateBaserowRow } from '@/lib/baserow-actions';
import { useState } from 'react';

interface SceneCardProps {
  data: BaserowRow[];
  onRefresh?: () => void;
}

export default function SceneCard({ data, onRefresh }: SceneCardProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  const handleEditStart = (sceneId: number, currentText: string) => {
    setEditingId(sceneId);
    setEditingText(currentText);
  };

  const handleEditSave = async (sceneId: number) => {
    if (isUpdating) return;

    setIsUpdating(true);
    try {
      await updateBaserowRow(sceneId, { field_6890: editingText });
      setEditingId(null);
      onRefresh?.(); // Refresh the data after successful update
    } catch (error) {
      console.error('Error updating sentence:', error);
      alert('Failed to update sentence. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditingText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, sceneId: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave(sceneId);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  if (data.length === 0) {
    return (
      <div className='p-8 text-center'>
        <div className='bg-gray-50 rounded-lg p-6'>
          <p className='text-gray-600 mb-4'>
            No scenes found in your Baserow table.
          </p>
          <p className='text-sm text-gray-500'>
            Make sure your Baserow configuration is correct and your table
            contains data.
          </p>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className='mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
            >
              Refresh Data
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className='p-6'>
      <div className='flex justify-between items-center mb-6'>
        <div>
          <h2 className='text-2xl font-bold text-gray-800'>Scenes for Edit</h2>
          <p className='text-sm text-gray-600 mt-1'>
            {data.length} scene{data.length !== 1 ? 's' : ''} found
          </p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
          >
            Refresh Data
          </button>
        )}
      </div>

      <div className='space-y-4'>
        {data.map((scene, index) => (
          <div
            key={scene.id || index}
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
                <label className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                  Sentence{' '}
                  {isUpdating && editingId === scene.id && '(Saving...)'}
                </label>
                {editingId === scene.id ? (
                  <div className='mt-1'>
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, scene.id)}
                      onBlur={() => handleEditSave(scene.id)}
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
    </div>
  );
}
