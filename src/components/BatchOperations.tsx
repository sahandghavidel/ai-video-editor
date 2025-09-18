'use client';

import { BaserowRow } from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import {
  handleImproveAllSentences,
  handleGenerateAllTTS,
  handleGenerateAllVideos,
  handleConcatenateAllVideos,
  handleSpeedUpAllVideos,
  cycleSpeed as cycleThroughSpeeds,
} from '@/utils/batchOperations';
import {
  Loader2,
  Sparkles,
  Mic,
  Film,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface BatchOperationsProps {
  data: BaserowRow[];
  onRefresh?: () => void;
  refreshing?: boolean;
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
}

export default function BatchOperations({
  data,
  onRefresh,
  refreshing = false,
  handleSentenceImprovement,
  handleTTSProduce,
  handleVideoGenerate,
}: BatchOperationsProps) {
  const {
    batchOperations,
    modelSelection,
    videoSettings,
    updateVideoSettings,
    startBatchOperation,
    completeBatchOperation,
    setProducingTTS,
    sceneLoading,
    setImprovingSentence,
    setSpeedingUpVideo,
    setGeneratingVideo,
  } = useAppStore();

  const onImproveAllSentences = () => {
    handleImproveAllSentences(
      data,
      handleSentenceImprovement,
      modelSelection.selectedModel,
      startBatchOperation,
      completeBatchOperation,
      setImprovingSentence
    );
  };

  const onGenerateAllTTS = () => {
    handleGenerateAllTTS(
      data,
      handleTTSProduce,
      startBatchOperation,
      completeBatchOperation,
      setProducingTTS
    );
  };

  const onGenerateAllVideos = () => {
    handleGenerateAllVideos(
      data,
      handleVideoGenerate,
      startBatchOperation,
      completeBatchOperation,
      setGeneratingVideo,
      onRefresh
    );
  };

  const onConcatenateAllVideos = () => {
    handleConcatenateAllVideos(
      data,
      startBatchOperation,
      completeBatchOperation
    );
  };

  const onSpeedUpAllVideos = () => {
    handleSpeedUpAllVideos(
      data,
      videoSettings.selectedSpeed,
      videoSettings.muteAudio,
      onRefresh,
      startBatchOperation,
      completeBatchOperation,
      setSpeedingUpVideo
    );
  };

  const cycleSpeed = () => {
    cycleThroughSpeeds(videoSettings.selectedSpeed, updateVideoSettings);
  };

  return (
    <div className='bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8'>
      {/* Header Section */}
      <div className='flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6'>
        <div className='mb-4 lg:mb-0'>
          <h2 className='text-3xl font-bold text-gray-900 mb-2'>
            Batch Operations
          </h2>
          <p className='text-gray-600 flex items-center gap-2'>
            <span className='inline-flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-800 text-sm font-medium rounded-full'>
              {data.length}
            </span>
            scene{data.length !== 1 ? 's' : ''} available for processing
          </p>
        </div>

        {/* Refresh Button */}
        {onRefresh && (
          <div className='flex-shrink-0'>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className='inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed min-w-[120px] justify-center'
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span>{refreshing ? 'Refreshing...' : 'Refresh Data'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Operation Cards Grid */}
      <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4'>
        {/* AI Improve All */}
        <div className='bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-4 border border-indigo-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-indigo-500 rounded-lg'>
              <Sparkles className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-indigo-900'>AI Improve</h3>
          </div>
          <p className='text-sm text-indigo-700 mb-4 leading-relaxed'>
            Enhance all sentences using AI with{' '}
            {modelSelection.selectedModel || 'default model'}
          </p>
          <button
            onClick={onImproveAllSentences}
            disabled={
              batchOperations.improvingAll ||
              sceneLoading.improvingSentence !== null
            }
            className='w-full h-12 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={
              batchOperations.improvingAll
                ? 'Improving all sentences with AI...'
                : sceneLoading.improvingSentence !== null
                ? `AI is improving sentence for scene ${sceneLoading.improvingSentence}`
                : 'Improve all sentences with AI'
            }
          >
            {(batchOperations.improvingAll ||
              sceneLoading.improvingSentence !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.improvingAll
                ? sceneLoading.improvingSentence !== null
                  ? `Scene #${sceneLoading.improvingSentence}`
                  : 'Processing...'
                : sceneLoading.improvingSentence !== null
                ? `Busy (#${sceneLoading.improvingSentence})`
                : 'Improve All'}
            </span>
          </button>
        </div>

        {/* Generate TTS */}
        <div className='bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-purple-500 rounded-lg'>
              <Mic className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-purple-900'>Generate TTS</h3>
          </div>
          <p className='text-sm text-purple-700 mb-4 leading-relaxed'>
            Create audio from text for all scenes missing TTS audio
          </p>
          <button
            onClick={onGenerateAllTTS}
            disabled={
              batchOperations.generatingAllTTS ||
              sceneLoading.producingTTS !== null
            }
            className='w-full h-12 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={
              batchOperations.generatingAllTTS
                ? 'Generating TTS for all scenes...'
                : sceneLoading.producingTTS !== null
                ? `TTS is being generated for scene ${sceneLoading.producingTTS}`
                : 'Generate TTS for all scenes'
            }
          >
            {(batchOperations.generatingAllTTS ||
              sceneLoading.producingTTS !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.generatingAllTTS
                ? sceneLoading.producingTTS !== null
                  ? `Scene #${sceneLoading.producingTTS}`
                  : 'Processing...'
                : sceneLoading.producingTTS !== null
                ? `Busy (#${sceneLoading.producingTTS})`
                : 'Generate All'}
            </span>
          </button>
        </div>

        {/* Generate Videos */}
        <div className='bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg p-4 border border-teal-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-teal-500 rounded-lg'>
              <Film className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-teal-900'>Sync Videos</h3>
          </div>
          <p className='text-sm text-teal-700 mb-4 leading-relaxed'>
            Create synchronized videos for scenes with video and TTS audio
          </p>
          <button
            onClick={onGenerateAllVideos}
            disabled={
              batchOperations.generatingAllVideos ||
              sceneLoading.generatingVideo !== null
            }
            className='w-full h-12 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={
              batchOperations.generatingAllVideos
                ? 'Generate videos for all scenes with TTS audio...'
                : sceneLoading.generatingVideo !== null
                ? `Video is being generated for scene ${sceneLoading.generatingVideo}`
                : 'Generate synchronized videos'
            }
          >
            {(batchOperations.generatingAllVideos ||
              sceneLoading.generatingVideo !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.generatingAllVideos
                ? sceneLoading.generatingVideo !== null
                  ? `Scene #${sceneLoading.generatingVideo}`
                  : 'Processing...'
                : sceneLoading.generatingVideo !== null
                ? `Busy (#${sceneLoading.generatingVideo})`
                : 'Sync All'}
            </span>
          </button>
        </div>

        {/* Speed Up Videos */}
        <div className='bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-blue-500 rounded-lg flex items-center gap-1'>
              {videoSettings.muteAudio ? (
                <VolumeX className='w-4 h-4 text-white' />
              ) : (
                <Volume2 className='w-4 h-4 text-white' />
              )}
              <span className='text-white text-xs font-bold'>
                {videoSettings.selectedSpeed}x
              </span>
            </div>
            <h3 className='font-semibold text-blue-900'>Speed Up</h3>
          </div>
          <div className='flex items-center gap-2 mb-3'>
            <button
              onClick={() =>
                updateVideoSettings({ muteAudio: !videoSettings.muteAudio })
              }
              className='flex items-center gap-1 px-2 py-1 bg-blue-200 hover:bg-blue-300 text-blue-800 text-xs font-medium rounded transition-colors'
              title={`Click to ${
                videoSettings.muteAudio ? 'enable' : 'mute'
              } audio`}
            >
              {videoSettings.muteAudio ? (
                <VolumeX className='w-3 h-3' />
              ) : (
                <Volume2 className='w-3 h-3' />
              )}
              {videoSettings.muteAudio ? 'Muted' : 'Audio'}
            </button>
            <button
              onClick={cycleSpeed}
              className='px-2 py-1 bg-blue-200 hover:bg-blue-300 text-blue-800 text-xs font-bold rounded transition-colors'
              title='Click to cycle through speeds (1x → 2x → 4x)'
            >
              {videoSettings.selectedSpeed}x
            </button>
          </div>
          <button
            onClick={onSpeedUpAllVideos}
            disabled={
              batchOperations.speedingUpAllVideos ||
              sceneLoading.speedingUpVideo !== null
            }
            className='w-full h-12 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title={`Speed up all videos ${videoSettings.selectedSpeed}x and ${
              videoSettings.muteAudio ? 'mute' : 'keep'
            } audio`}
          >
            {(batchOperations.speedingUpAllVideos ||
              sceneLoading.speedingUpVideo !== null) && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.speedingUpAllVideos
                ? sceneLoading.speedingUpVideo !== null
                  ? `Scene #${sceneLoading.speedingUpVideo}`
                  : 'Processing...'
                : sceneLoading.speedingUpVideo !== null
                ? `Busy (#${sceneLoading.speedingUpVideo})`
                : 'Speed Up All'}
            </span>
          </button>
        </div>

        {/* Concatenate Videos */}
        <div className='bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200'>
          <div className='flex items-center gap-2 mb-3'>
            <div className='p-2 bg-orange-500 rounded-lg'>
              <Film className='w-4 h-4 text-white' />
            </div>
            <h3 className='font-semibold text-orange-900'>Merge Videos</h3>
          </div>
          <p className='text-sm text-orange-700 mb-4 leading-relaxed'>
            Combine all processed videos into one final video file
          </p>
          <button
            onClick={onConcatenateAllVideos}
            disabled={batchOperations.concatenatingVideos}
            className='w-full h-12 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md disabled:cursor-not-allowed'
            title='Concatenate all videos into one final video'
          >
            {batchOperations.concatenatingVideos && (
              <Loader2 className='w-4 h-4 animate-spin' />
            )}
            <span className='font-medium'>
              {batchOperations.concatenatingVideos ? 'Merging...' : 'Merge All'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
