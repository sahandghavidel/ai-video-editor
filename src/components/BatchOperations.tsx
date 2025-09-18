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
    setImprovingSentence,
    setSpeedingUpVideo,
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
          disabled={
            batchOperations.improvingAll ||
            sceneLoading.improvingSentence !== null
          }
          className={`px-4 py-2 h-10 bg-indigo-500 text-white rounded hover:bg-indigo-600 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            sceneLoading.improvingSentence !== null &&
            !batchOperations.improvingAll
              ? 'opacity-50'
              : ''
          }`}
          title={
            batchOperations.improvingAll
              ? 'Improving all sentences with AI...'
              : sceneLoading.improvingSentence !== null
              ? `AI is improving sentence for scene ${sceneLoading.improvingSentence}`
              : modelSelection.selectedModel
              ? `Improve all sentences with AI using: ${modelSelection.selectedModel}`
              : 'Improve all sentences with AI (no model selected)'
          }
        >
          {batchOperations.improvingAll ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : sceneLoading.improvingSentence !== null ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : (
            <Sparkles className='h-4 w-4' />
          )}
          <span>
            {batchOperations.improvingAll
              ? sceneLoading.improvingSentence !== null
                ? `Improving All (Scene #${sceneLoading.improvingSentence})...`
                : 'Improving All...'
              : sceneLoading.improvingSentence !== null
              ? `AI Busy (Scene #${sceneLoading.improvingSentence})`
              : 'AI Improve All'}
          </span>
        </button>
        <button
          onClick={onGenerateAllTTS}
          disabled={
            batchOperations.generatingAllTTS ||
            sceneLoading.producingTTS !== null
          }
          className={`px-4 py-2 h-10 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            sceneLoading.producingTTS !== null &&
            !batchOperations.generatingAllTTS
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
              ? sceneLoading.producingTTS !== null
                ? `Generating TTS (Scene #${sceneLoading.producingTTS})...`
                : 'Generating TTS...'
              : sceneLoading.producingTTS !== null
              ? `TTS Busy (Scene #${sceneLoading.producingTTS})`
              : 'Generate TTS for All'}
          </span>
        </button>
        <button
          onClick={onConcatenateAllVideos}
          disabled={batchOperations.concatenatingVideos}
          className='px-4 py-2 h-10 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed'
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
          disabled={
            batchOperations.speedingUpAllVideos ||
            sceneLoading.speedingUpVideo !== null
          }
          className={`px-4 py-2 h-10 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            sceneLoading.speedingUpVideo !== null &&
            !batchOperations.speedingUpAllVideos
              ? 'opacity-50'
              : ''
          }`}
          title={
            batchOperations.speedingUpAllVideos
              ? sceneLoading.speedingUpVideo !== null
                ? `Speed up all videos ${videoSettings.selectedSpeed}x and ${
                    videoSettings.muteAudio ? 'mute' : 'keep'
                  } audio for scenes with empty sentences... (Scene #${
                    sceneLoading.speedingUpVideo
                  })`
                : `Speed up all videos ${videoSettings.selectedSpeed}x and ${
                    videoSettings.muteAudio ? 'mute' : 'keep'
                  } audio for scenes with empty sentences...`
              : sceneLoading.speedingUpVideo !== null
              ? `Video is being sped up for scene ${sceneLoading.speedingUpVideo}`
              : `Speed up all videos ${videoSettings.selectedSpeed}x and ${
                  videoSettings.muteAudio ? 'mute' : 'keep'
                } audio for scenes with empty sentences`
          }
        >
          {batchOperations.speedingUpAllVideos ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : sceneLoading.speedingUpVideo !== null ? (
            <Loader2 className='animate-spin h-4 w-4' />
          ) : (
            <div className='flex items-center space-x-1'>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  updateVideoSettings({
                    muteAudio: !videoSettings.muteAudio,
                  });
                }}
                className='hover:scale-110 transition-transform duration-200 cursor-pointer'
                title={`Click to ${
                  videoSettings.muteAudio ? 'enable' : 'mute'
                } audio`}
              >
                {videoSettings.muteAudio ? (
                  <VolumeX className='h-4 w-4' />
                ) : (
                  <Volume2 className='h-4 w-4' />
                )}
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  cycleSpeed();
                }}
                className='px-1 py-0.5 text-xs font-bold hover:bg-white/20 rounded transition-colors duration-200 cursor-pointer'
                title='Click to cycle through speeds (1x → 2x → 4x)'
              >
                {videoSettings.selectedSpeed}x
              </div>
            </div>
          )}
          <span>
            {batchOperations.speedingUpAllVideos
              ? sceneLoading.speedingUpVideo !== null
                ? `Processing (Scene #${sceneLoading.speedingUpVideo})...`
                : 'Processing All...'
              : sceneLoading.speedingUpVideo !== null
              ? `Busy (Scene #${sceneLoading.speedingUpVideo})`
              : 'Up All Videos'}
          </span>
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className='px-4 py-2 h-10 bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center justify-center space-x-2'
          >
            <RefreshCw className='w-4 h-4' />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );
}
