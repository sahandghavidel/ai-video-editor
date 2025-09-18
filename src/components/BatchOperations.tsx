'use client';

import { BaserowRow } from '@/lib/baserow-actions';
import { useAppStore } from '@/store/useAppStore';
import {
  handleImproveAllSentences,
  handleGenerateAllTTS,
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
  handleSentenceImprovement: (
    sceneId: number,
    sentence: string,
    model?: string
  ) => Promise<void>;
  handleTTSProduce: (sceneId: number, text: string) => Promise<void>;
}

export default function BatchOperations({
  data,
  onRefresh,
  handleSentenceImprovement,
  handleTTSProduce,
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
  } = useAppStore();

  const onImproveAllSentences = () => {
    handleImproveAllSentences(
      data,
      handleSentenceImprovement,
      modelSelection.selectedModel,
      startBatchOperation,
      completeBatchOperation
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
      completeBatchOperation
    );
  };

  const cycleSpeed = () => {
    cycleThroughSpeeds(videoSettings.selectedSpeed, updateVideoSettings);
  };

  return (
    <div className='flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4'>
      <div>
        <h2 className='text-2xl font-bold text-gray-800'>Scenes</h2>
        <p className='text-gray-600 mt-1'>
          {data.length} scene{data.length !== 1 ? 's' : ''} found
        </p>
      </div>
      <div className='flex flex-col md:flex-row gap-2'>
        <button
          onClick={onImproveAllSentences}
          disabled={batchOperations.improvingAll}
          className='px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed'
          title={
            modelSelection.selectedModel
              ? `Improve all sentences with AI using: ${modelSelection.selectedModel}`
              : 'Improve all sentences with AI (no model selected)'
          }
        >
          {batchOperations.improvingAll ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : (
            <Sparkles className='h-4 w-4' />
          )}
          <span>
            {batchOperations.improvingAll
              ? 'Improving All...'
              : 'AI Improve All'}
          </span>
        </button>
        <button
          onClick={onGenerateAllTTS}
          disabled={batchOperations.generatingAllTTS || sceneLoading.producingTTS !== null}
          className={`px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            sceneLoading.producingTTS !== null && !batchOperations.generatingAllTTS
              ? 'opacity-50'
              : ''
          }`}
          title={
            batchOperations.generatingAllTTS
              ? 'Generating TTS for all scenes...'
              : sceneLoading.producingTTS !== null
              ? `TTS is being generated for scene ${sceneLoading.producingTTS}`
              : 'Generate TTS for all scenes that have text but no audio'
          }
        >
          {batchOperations.generatingAllTTS ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : sceneLoading.producingTTS !== null ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : (
            <Mic className='h-4 w-4' />
          )}
          <span>
            {batchOperations.generatingAllTTS
              ? 'Generating TTS...'
              : sceneLoading.producingTTS !== null
              ? 'TTS Busy'
              : 'Generate TTS for All'}
          </span>
        </button>
        <button
          onClick={onConcatenateAllVideos}
          disabled={batchOperations.concatenatingVideos}
          className='px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed'
          title='Concatenate all videos into one final video'
        >
          {batchOperations.concatenatingVideos ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : (
            <Film className='h-4 w-4' />
          )}
          <span>
            {batchOperations.concatenatingVideos
              ? 'Concatenating...'
              : 'Concatenate All Videos'}
          </span>
        </button>
        <button
          onClick={onSpeedUpAllVideos}
          disabled={batchOperations.speedingUpAllVideos}
          className='px-6 py-3 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-xl transition-all duration-300 flex items-center space-x-3 disabled:opacity-50 disabled:cursor-not-allowed'
          title={`Speed up all videos ${videoSettings.selectedSpeed}x and ${
            videoSettings.muteAudio ? 'mute' : 'keep'
          } audio for scenes with empty sentences`}
        >
          {batchOperations.speedingUpAllVideos ? (
            <Loader2 className='animate-spin h-5 w-5' />
          ) : (
            <div className='flex items-center space-x-2'>
              <div className='p-1.5 bg-blue-600/20 rounded-lg backdrop-blur-sm'>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    updateVideoSettings({
                      muteAudio: !videoSettings.muteAudio,
                    });
                  }}
                  className='p-0 bg-transparent border-none hover:scale-125 transition-transform duration-200 cursor-pointer'
                  title={`Click to ${
                    videoSettings.muteAudio ? 'enable' : 'mute'
                  } audio`}
                >
                  {videoSettings.muteAudio ? (
                    <VolumeX className='h-4 w-4 text-blue-700' />
                  ) : (
                    <Volume2 className='h-4 w-4 text-blue-700' />
                  )}
                </div>
              </div>
              <div className='w-px h-6 bg-blue-700/30'></div>
            </div>
          )}
          <div className='flex flex-col items-start'>
            <span className='font-semibold text-sm'>
              {batchOperations.speedingUpAllVideos
                ? 'Processing Videos...'
                : 'Speed Up All Videos'}
            </span>
            {!batchOperations.speedingUpAllVideos && (
              <div className='flex items-center space-x-1 text-xs text-blue-700/90'>
                <span>Speed:</span>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    cycleSpeed();
                  }}
                  className='px-2 py-0.5 bg-blue-600/20 rounded-md font-bold hover:bg-blue-600/30 transition-colors duration-200 backdrop-blur-sm border border-blue-700/20 cursor-pointer'
                  title='Click to cycle through speeds (1x → 2x → 4x)'
                >
                  {videoSettings.selectedSpeed}x
                </div>
              </div>
            )}
          </div>
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className='px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center space-x-2'
          >
            <RefreshCw className='w-4 h-4' />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );
}
