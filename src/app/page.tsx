'use client';

import { getBaserowData, BaserowRow } from '@/lib/baserow-actions';
import SceneCard from '@/components/SceneCard';
import BatchOperations from '@/components/BatchOperations';
import ModelSelection from '@/components/ModelSelection';
import TranscriptionModelSelection from '@/components/TranscriptionModelSelection';
import TTSSettings from '@/components/TTSSettings';
import VideoSpeedSettings from '@/components/VideoSpeedSettings';
import AutoGenerateSettings from '@/components/AutoGenerateSettings';
import SilenceSpeedSettings from '@/components/SilenceSpeedSettings';
import AudioEnhancementSettings from '@/components/AudioEnhancementSettings';
import AdvancedAudioSettings from '@/components/AdvancedAudioSettings';
import DeletionSettings from '@/components/DeletionSettings';
import SubtitleGenerationSettings from '@/components/SubtitleGenerationSettings';
import CombineScenesSettings from '@/components/CombineScenesSettings';
import SceneVideoGenerationSettings from '@/components/SceneVideoGenerationSettings';
import OriginalVideosList from '@/components/OriginalVideosList';
import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { AlertCircle, Video, Loader2, RefreshCw, Settings } from 'lucide-react';

type GlobalSettingsSectionKey =
  | 'modelSelection'
  | 'transcription'
  | 'subtitleGeneration'
  | 'combineScenes'
  | 'ttsSettings'
  | 'sceneVideoGeneration'
  | 'videoSpeed'
  | 'silenceSpeed'
  | 'audioEnhancement'
  | 'advancedAudio'
  | 'autoGenerate'
  | 'deletion';

const defaultGlobalSettingsSectionsExpanded: Record<
  GlobalSettingsSectionKey,
  boolean
> = {
  modelSelection: false,
  transcription: false,
  subtitleGeneration: false,
  combineScenes: false,
  ttsSettings: false,
  sceneVideoGeneration: false,
  videoSpeed: false,
  silenceSpeed: false,
  audioEnhancement: false,
  advancedAudio: false,
  autoGenerate: false,
  deletion: false,
};

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
  const [globalSettingsSectionsExpanded, setGlobalSettingsSectionsExpanded] =
    useState<Record<GlobalSettingsSectionKey, boolean>>(
      defaultGlobalSettingsSectionsExpanded,
    );

  // Get filtered data based on selected original video
  const filteredData = getFilteredData();
  const displayData = filteredData;

  const [sceneHandlers, setSceneHandlers] = useState<{
    handleAutoFixMismatch: (
      sceneId: number,
      sceneData?: BaserowRow,
      options?: { maxAttempts?: number },
    ) => Promise<void>;
    handleSentenceImprovement: (
      sceneId: number,
      sentence: string,
      model?: string,
      sceneData?: BaserowRow,
      skipRefresh?: boolean,
      enforceLongerSentences?: boolean,
    ) => Promise<void>;
    handleTTSProduce: (
      sceneId: number,
      text: string,
      sceneData?: BaserowRow,
    ) => Promise<void>;
    handleVideoGenerate: (
      sceneId: number,
      videoUrl: string,
      audioUrl: string,
    ) => Promise<void>;
    handleSpeedUpVideo: (
      sceneId: number,
      sceneData?: BaserowRow,
      skipRefresh?: boolean,
    ) => Promise<void>;
    handleTranscribeScene: (
      sceneId: number,
      sceneData?: BaserowRow,
      videoType?: 'original' | 'final',
      skipRefresh?: boolean,
      skipSound?: boolean,
    ) => Promise<void>;
  } | null>(null);

  const loadData = useCallback(async () => {
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
  }, [setData, setError]);

  const refreshDataSilently = useCallback(async () => {
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
  }, [setData, setError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDataUpdate = (updatedData: BaserowRow[]) => {
    setData(updatedData);
  };

  const handleSceneHandlersReady = useCallback(
    (handlers: {
      handleAutoFixMismatch: (
        sceneId: number,
        sceneData?: BaserowRow,
        options?: { maxAttempts?: number },
      ) => Promise<void>;
      handleSentenceImprovement: (
        sceneId: number,
        sentence: string,
        model?: string,
        sceneData?: BaserowRow,
        skipRefresh?: boolean,
      ) => Promise<void>;
      handleTTSProduce: (
        sceneId: number,
        text: string,
        sceneData?: BaserowRow,
      ) => Promise<void>;
      handleVideoGenerate: (
        sceneId: number,
        videoUrl: string,
        audioUrl: string,
      ) => Promise<void>;
      handleSpeedUpVideo: (
        sceneId: number,
        sceneData?: BaserowRow,
        skipRefresh?: boolean,
      ) => Promise<void>;
      handleTranscribeScene: (
        sceneId: number,
        sceneData?: BaserowRow,
        videoType?: 'original' | 'final',
        skipRefresh?: boolean,
        skipSound?: boolean,
      ) => Promise<void>;
    }) => {
      setSceneHandlers(handlers);
    },
    [],
  );

  const refreshData = () => {
    refreshDataSilently();
  };

  const globalSettingsSections: Array<{
    key: GlobalSettingsSectionKey;
    title: string;
    component: JSX.Element;
  }> = [
    {
      key: 'modelSelection',
      title: 'AI Models',
      component: <ModelSelection />,
    },
    {
      key: 'transcription',
      title: 'Transcription',
      component: <TranscriptionModelSelection />,
    },
    {
      key: 'subtitleGeneration',
      title: 'Subtitles',
      component: <SubtitleGenerationSettings />,
    },
    {
      key: 'combineScenes',
      title: 'Combine Scenes',
      component: <CombineScenesSettings />,
    },
    {
      key: 'ttsSettings',
      title: 'TTS',
      component: <TTSSettings />,
    },
    {
      key: 'sceneVideoGeneration',
      title: 'Scene Video Generation',
      component: <SceneVideoGenerationSettings />,
    },
    {
      key: 'videoSpeed',
      title: 'Video Speed',
      component: <VideoSpeedSettings />,
    },
    {
      key: 'silenceSpeed',
      title: 'Silence Speed',
      component: <SilenceSpeedSettings />,
    },
    {
      key: 'audioEnhancement',
      title: 'Audio Enhancement',
      component: <AudioEnhancementSettings />,
    },
    {
      key: 'advancedAudio',
      title: 'Advanced Audio',
      component: <AdvancedAudioSettings />,
    },
    {
      key: 'autoGenerate',
      title: 'Auto-Generation',
      component: <AutoGenerateSettings />,
    },
    {
      key: 'deletion',
      title: 'Deletion',
      component: <DeletionSettings />,
    },
  ];

  const allGlobalSettingsSectionsExpanded = Object.values(
    globalSettingsSectionsExpanded,
  ).every(Boolean);

  const toggleGlobalSettingsSection = (key: GlobalSettingsSectionKey) => {
    setGlobalSettingsSectionsExpanded((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleAllGlobalSettingsSections = () => {
    const shouldExpandAll = !allGlobalSettingsSectionsExpanded;
    const nextValue: Record<GlobalSettingsSectionKey, boolean> = {
      modelSelection: shouldExpandAll,
      transcription: shouldExpandAll,
      subtitleGeneration: shouldExpandAll,
      combineScenes: shouldExpandAll,
      ttsSettings: shouldExpandAll,
      sceneVideoGeneration: shouldExpandAll,
      videoSpeed: shouldExpandAll,
      silenceSpeed: shouldExpandAll,
      audioEnhancement: shouldExpandAll,
      advancedAudio: shouldExpandAll,
      autoGenerate: shouldExpandAll,
      deletion: shouldExpandAll,
    };

    setGlobalSettingsSectionsExpanded(nextValue);
  };

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-50 to-white'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
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
            {!initialLoading && (
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
                      <h2 className='text-lg font-semibold text-gray-900'>
                        Global Settings
                      </h2>
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
                    <div className='mb-3 flex items-center justify-end'>
                      <button
                        onClick={toggleAllGlobalSettingsSections}
                        className='px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 border border-blue-200 rounded-md transition-colors'
                        title={
                          allGlobalSettingsSectionsExpanded
                            ? 'Collapse all global settings sections'
                            : 'Expand all global settings sections'
                        }
                      >
                        {allGlobalSettingsSectionsExpanded
                          ? 'Collapse All Sections'
                          : 'Expand All Sections'}
                      </button>
                    </div>

                    <div
                      className='grid gap-3'
                      style={{
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(320px, 1fr))',
                      }}
                    >
                      {globalSettingsSections.map((section) => {
                        const isSectionExpanded =
                          globalSettingsSectionsExpanded[section.key];

                        return (
                          <div
                            key={section.key}
                            className='rounded-xl border border-blue-200 bg-white/70 overflow-hidden'
                          >
                            <button
                              onClick={() =>
                                toggleGlobalSettingsSection(section.key)
                              }
                              className='w-full px-4 py-2.5 flex items-center justify-between hover:bg-blue-50 transition-colors'
                              title={`${isSectionExpanded ? 'Collapse' : 'Expand'} ${section.title}`}
                            >
                              <span className='text-sm font-semibold text-gray-800'>
                                {section.title}
                              </span>
                              <div className='flex items-center gap-2'>
                                <span className='text-xs text-gray-500'>
                                  {isSectionExpanded ? 'Hide' : 'Show'}
                                </span>
                                <svg
                                  className={`w-4 h-4 text-gray-400 transition-transform ${
                                    isSectionExpanded ? 'rotate-180' : ''
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

                            {isSectionExpanded && (
                              <div className='px-2 pb-2'>
                                {section.component}
                              </div>
                            )}
                          </div>
                        );
                      })}
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

            {/* Batch Operations - Only show when data is available and handlers are ready */}
            {!initialLoading && displayData.length > 0 && sceneHandlers && (
              <BatchOperations
                data={displayData}
                onRefresh={refreshData}
                refreshing={refreshing}
                handleAutoFixMismatch={sceneHandlers.handleAutoFixMismatch}
                handleSentenceImprovement={
                  sceneHandlers.handleSentenceImprovement
                }
                handleTTSProduce={sceneHandlers.handleTTSProduce}
                handleVideoGenerate={sceneHandlers.handleVideoGenerate}
                handleTranscribeScene={sceneHandlers.handleTranscribeScene}
              />
            )}

            {/* Scene Cards - Only show when a video is selected */}
            {selectedOriginalVideo.id ? (
              <SceneCard
                data={displayData}
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
