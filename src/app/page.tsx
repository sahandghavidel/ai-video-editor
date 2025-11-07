'use client';

import { getBaserowData, BaserowRow } from '@/lib/baserow-actions';
import SceneCard from '@/components/SceneCard';
import BatchOperations from '@/components/BatchOperations';
import ModelSelection from '@/components/ModelSelection';
import TranscriptionModelSelection from '@/components/TranscriptionModelSelection';
import TTSSettings from '@/components/TTSSettings';
import VideoSpeedSettings from '@/components/VideoSpeedSettings';
import AutoGenerateSettings from '@/components/AutoGenerateSettings';
import OriginalVideosList from '@/components/OriginalVideosList';
import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { AlertCircle, Video, Loader2, RefreshCw, Settings } from 'lucide-react';

export default function Home() {
  const {
    data,
    error,
    setData,
    setError,
    getFilteredData,
    selectedOriginalVideo,
  } = useAppStore();
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isGlobalSettingsExpanded, setIsGlobalSettingsExpanded] =
    useState(false); // Global settings collapsed by default

  // Get filtered data based on selected original video
  const filteredData = getFilteredData();

  const [sceneHandlers, setSceneHandlers] = useState<{
    handleSentenceImprovement: (
      sceneId: number,
      sentence: string,
      model?: string,
      sceneData?: BaserowRow,
      skipRefresh?: boolean
    ) => Promise<void>;
    handleTTSProduce: (
      sceneId: number,
      text: string,
      sceneData?: BaserowRow
    ) => Promise<void>;
    handleVideoGenerate: (
      sceneId: number,
      videoUrl: string,
      audioUrl: string
    ) => Promise<void>;
    handleSpeedUpVideo: (
      sceneId: number,
      sceneData?: BaserowRow,
      skipRefresh?: boolean
    ) => Promise<void>;
  } | null>(null);

  const loadData = async () => {
    try {
      setInitialLoading(true);
      const fetchedData = await getBaserowData();
      setData(fetchedData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
      console.error('Error loading Baserow data:', err);
    } finally {
      setInitialLoading(false);
    }
  };

  const refreshDataSilently = async () => {
    setRefreshing(true);
    try {
      const fetchedData = await getBaserowData();
      setData(fetchedData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh data');
      console.error('Error refreshing Baserow data:', err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDataUpdate = (updatedData: BaserowRow[]) => {
    setData(updatedData);
  };

  const handleSceneHandlersReady = useCallback(
    (handlers: {
      handleSentenceImprovement: (
        sceneId: number,
        sentence: string,
        model?: string,
        sceneData?: BaserowRow,
        skipRefresh?: boolean
      ) => Promise<void>;
      handleTTSProduce: (
        sceneId: number,
        text: string,
        sceneData?: BaserowRow
      ) => Promise<void>;
      handleVideoGenerate: (
        sceneId: number,
        videoUrl: string,
        audioUrl: string
      ) => Promise<void>;
      handleSpeedUpVideo: (
        sceneId: number,
        sceneData?: BaserowRow,
        skipRefresh?: boolean
      ) => Promise<void>;
    }) => {
      setSceneHandlers(handlers);
    },
    []
  );

  const refreshData = () => {
    refreshDataSilently();
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-50 to-white'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <header className='mb-8'>
          <div className='flex items-center space-x-4 mb-4'>
            <div className='p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg'>
              <Video className='w-8 h-8 text-white' />
            </div>
            <div>
              <h1 className='text-3xl font-bold text-gray-900'>
                Ultimate Video Editor
              </h1>
              <p className='mt-2 text-gray-600'>
                AI-powered video editing with TTS and scene management
              </p>
            </div>
          </div>
        </header>

        {error ? (
          <div className='bg-red-50 border border-red-200 rounded-xl p-6 mb-8 shadow-sm'>
            <div className='flex items-start space-x-4'>
              <div className='flex-shrink-0'>
                <div className='p-2 bg-red-100 rounded-lg'>
                  <AlertCircle className='h-5 w-5 text-red-600' />
                </div>
              </div>
              <div className='flex-1 min-w-0'>
                <h3 className='text-lg font-semibold text-red-800 mb-2'>
                  Configuration Error
                </h3>
                <div className='text-sm text-red-700 space-y-3'>
                  <p className='font-medium'>{error}</p>
                  <div>
                    <p className='mb-2'>
                      Please check your{' '}
                      <code className='bg-red-100 px-2 py-1 rounded font-mono text-xs'>
                        .env.local
                      </code>{' '}
                      file and ensure:
                    </p>
                    <ul className='space-y-2 list-none'>
                      <li className='flex items-center space-x-2'>
                        <div className='w-1.5 h-1.5 bg-red-500 rounded-full'></div>
                        <span>
                          <code className='bg-red-100 px-1 rounded text-xs'>
                            BASEROW_API_URL
                          </code>{' '}
                          is set (e.g., http://host.docker.internal/api)
                        </span>
                      </li>
                      <li className='flex items-center space-x-2'>
                        <div className='w-1.5 h-1.5 bg-red-500 rounded-full'></div>
                        <span>
                          <code className='bg-red-100 px-1 rounded text-xs'>
                            BASEROW_EMAIL
                          </code>{' '}
                          is set with your Baserow login email
                        </span>
                      </li>
                      <li className='flex items-center space-x-2'>
                        <div className='w-1.5 h-1.5 bg-red-500 rounded-full'></div>
                        <span>
                          <code className='bg-red-100 px-1 rounded text-xs'>
                            BASEROW_PASSWORD
                          </code>{' '}
                          is set with your Baserow password
                        </span>
                      </li>
                      <li className='flex items-center space-x-2'>
                        <div className='w-1.5 h-1.5 bg-red-500 rounded-full'></div>
                        <span>
                          <code className='bg-red-100 px-1 rounded text-xs'>
                            BASEROW_TABLE_ID
                          </code>{' '}
                          is set with your table ID
                        </span>
                      </li>
                    </ul>
                  </div>
                  <button
                    onClick={refreshData}
                    className='mt-4 inline-flex items-center px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors text-sm font-medium'
                  >
                    <RefreshCw className='w-4 h-4 mr-2' />
                    Retry Connection
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className='space-y-8'>
            {initialLoading && (
              <div className='flex flex-col items-center justify-center py-12 space-y-4'>
                <div className='p-4 bg-blue-50 rounded-full'>
                  <Loader2 className='w-8 h-8 text-blue-600 animate-spin' />
                </div>
                <div className='text-center'>
                  <p className='text-lg font-medium text-gray-900'>
                    Loading scenes...
                  </p>
                  <p className='text-sm text-gray-600'>
                    Connecting to Baserow database
                  </p>
                </div>
              </div>
            )}

            {/* Global Settings - Collapsible */}
            {!initialLoading && data.length > 0 && (
              <div className='bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 overflow-hidden mb-6'>
                {/* Settings Header */}
                <button
                  onClick={() =>
                    setIsGlobalSettingsExpanded(!isGlobalSettingsExpanded)
                  }
                  className='w-full px-6 py-4 flex items-center justify-between hover:bg-white/50 transition-colors'
                >
                  <div className='flex items-center gap-3'>
                    <Settings className='w-6 h-6 text-blue-600' />
                    <div className='text-left'>
                      <h2 className='text-xl font-bold text-gray-900'>
                        Global Settings
                      </h2>
                      <p className='text-sm text-gray-600'>
                        AI Models, Transcription, TTS, Video Speed &
                        Auto-Generation
                      </p>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <span className='text-xs text-gray-400'>
                      {isGlobalSettingsExpanded
                        ? 'Click to collapse'
                        : 'Click to expand'}
                    </span>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${
                        isGlobalSettingsExpanded ? 'rotate-180' : ''
                      }`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M19 9l-7 7-7-7'
                      />
                    </svg>
                  </div>
                </button>

                {/* Collapsible Settings Content */}
                {isGlobalSettingsExpanded && (
                  <div className='px-6 pb-6 pt-2'>
                    <div
                      className='grid gap-3'
                      style={{
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(320px, 1fr))',
                      }}
                    >
                      <ModelSelection />
                      <TranscriptionModelSelection />
                      <TTSSettings />
                      <VideoSpeedSettings />
                      <AutoGenerateSettings />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Original Videos List */}
            <OriginalVideosList
              sceneHandlers={sceneHandlers}
              refreshScenesData={refreshData}
            />

            {/* No Video Selected Message */}
            {!initialLoading &&
              data.length > 0 &&
              !selectedOriginalVideo.id && (
                <div className='bg-amber-50 border border-amber-200 rounded-xl p-6 text-center'>
                  <Video className='w-12 h-12 text-amber-500 mx-auto mb-4' />
                  <h3 className='text-lg font-semibold text-amber-900 mb-2'>
                    No Original Video Selected
                  </h3>
                  <p className='text-amber-700'>
                    Please select an original video from the table above to view
                    and edit its scenes.
                  </p>
                </div>
              )}

            {/* Batch Operations - Only show when filtered data is available and handlers are ready */}
            {!initialLoading && filteredData.length > 0 && sceneHandlers && (
              <BatchOperations
                data={filteredData}
                onRefresh={refreshData}
                refreshing={refreshing}
                handleSentenceImprovement={
                  sceneHandlers.handleSentenceImprovement
                }
                handleTTSProduce={sceneHandlers.handleTTSProduce}
                handleVideoGenerate={sceneHandlers.handleVideoGenerate}
              />
            )}

            {/* Scene Cards - Only show when a video is selected */}
            {selectedOriginalVideo.id ? (
              <SceneCard
                data={filteredData}
                refreshData={refreshData}
                refreshing={refreshing}
                onDataUpdate={handleDataUpdate}
                onHandlersReady={handleSceneHandlersReady}
              />
            ) : (
              !initialLoading &&
              data.length > 0 && (
                <div className='bg-gray-50 border border-gray-200 rounded-xl p-8 text-center'>
                  <div className='text-gray-400 mb-4'>
                    <Video className='w-16 h-16 mx-auto' />
                  </div>
                  <h3 className='text-xl font-semibold text-gray-700 mb-2'>
                    Ready to Edit Scenes
                  </h3>
                  <p className='text-gray-600'>
                    Select an original video from the table above to start
                    editing its scenes.
                  </p>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
