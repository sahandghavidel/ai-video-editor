'use client';

import { getBaserowData, BaserowRow } from '@/lib/baserow-actions';
import SceneCard from '@/components/SceneCard';
import BatchOperations from '@/components/BatchOperations';
import ModelSelection from '@/components/ModelSelection';
import TTSSettings from '@/components/TTSSettings';
import VideoSpeedSettings from '@/components/VideoSpeedSettings';
import AutoGenerateSettings from '@/components/AutoGenerateSettings';
import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { AlertCircle, Video, Loader2, RefreshCw } from 'lucide-react';

export default function Home() {
  const { data, error, setData, setError } = useAppStore();
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sceneHandlers, setSceneHandlers] = useState<{
    handleSentenceImprovement: (
      sceneId: number,
      sentence: string,
      model?: string
    ) => Promise<void>;
    handleTTSProduce: (sceneId: number, text: string) => Promise<void>;
    handleVideoGenerate: (
      sceneId: number,
      videoUrl: string,
      audioUrl: string
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
        model?: string
      ) => Promise<void>;
      handleTTSProduce: (sceneId: number, text: string) => Promise<void>;
      handleVideoGenerate: (
        sceneId: number,
        videoUrl: string,
        audioUrl: string
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

            {/* Global Settings - Only show when data is loaded */}
            {!initialLoading && data.length > 0 && (
              <div className='space-y-6'>
                <ModelSelection />
                <TTSSettings />
                <VideoSpeedSettings />
                <AutoGenerateSettings />
              </div>
            )}

            {/* Batch Operations - Only show when data is loaded and handlers are ready */}
            {!initialLoading && data.length > 0 && sceneHandlers && (
              <BatchOperations
                data={data}
                onRefresh={refreshData}
                refreshing={refreshing}
                handleSentenceImprovement={
                  sceneHandlers.handleSentenceImprovement
                }
                handleTTSProduce={sceneHandlers.handleTTSProduce}
                handleVideoGenerate={sceneHandlers.handleVideoGenerate}
              />
            )}

            <SceneCard
              data={data}
              refreshData={refreshData}
              refreshing={refreshing}
              onDataUpdate={handleDataUpdate}
              onHandlersReady={handleSceneHandlersReady}
            />
          </div>
        )}
      </div>
    </div>
  );
}
