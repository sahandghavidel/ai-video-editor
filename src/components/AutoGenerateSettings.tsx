'use client';

import { useAppStore } from '@/store/useAppStore';
import { Mic, Video, Zap } from 'lucide-react';

export default function AutoGenerateSettings() {
  const { videoSettings, updateVideoSettings } = useAppStore();

  return (
    <div className='mb-6 p-4 sm:p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header */}
      <div className='flex items-center space-x-3 mb-6'>
        <div className='p-2 bg-gradient-to-br from-green-500 to-teal-600 rounded-lg shadow-sm'>
          <Zap className='w-5 h-5 text-white' />
        </div>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 mb-1'>
            Auto-Generation Settings
          </h3>
          <p className='text-sm text-gray-600'>
            Configure automatic content creation workflows
          </p>
        </div>
      </div>

      {/* Settings Grid */}
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
        {/* Auto-Generate TTS */}
        <div className='relative'>
          <label className='flex items-start space-x-4 cursor-pointer group'>
            <div className='relative flex-shrink-0 mt-1'>
              <input
                type='checkbox'
                checked={videoSettings.autoGenerateTTS}
                onChange={(e) =>
                  updateVideoSettings({ autoGenerateTTS: e.target.checked })
                }
                className='w-5 h-5 text-purple-600 bg-white border-2 border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors duration-200'
              />
            </div>
            <div className='flex-1 min-w-0'>
              <div className='flex items-center space-x-2 mb-2'>
                <div className='p-1.5 bg-purple-100 rounded-lg'>
                  <Mic className='w-4 h-4 text-purple-600' />
                </div>
                <span className='text-sm font-semibold text-gray-900 group-hover:text-purple-700 transition-colors'>
                  Auto-Generate TTS
                </span>
                {videoSettings.autoGenerateTTS && (
                  <div className='px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium'>
                    Active
                  </div>
                )}
              </div>
              <p className='text-xs text-gray-600 leading-relaxed'>
                Automatically create TTS audio when sentence is saved
              </p>
              {videoSettings.autoGenerateTTS && (
                <div className='mt-2 p-2 bg-purple-50 border border-purple-200 rounded-lg'>
                  <p className='text-xs text-purple-700'>
                    ✓ TTS will be generated automatically after editing
                    sentences
                  </p>
                </div>
              )}
            </div>
          </label>
        </div>

        {/* Auto-Generate Videos */}
        <div className='relative'>
          <label className='flex items-start space-x-4 cursor-pointer group'>
            <div className='relative flex-shrink-0 mt-1'>
              <input
                type='checkbox'
                checked={videoSettings.autoGenerateVideo}
                onChange={(e) =>
                  updateVideoSettings({ autoGenerateVideo: e.target.checked })
                }
                className='w-5 h-5 text-blue-600 bg-white border-2 border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200'
              />
            </div>
            <div className='flex-1 min-w-0'>
              <div className='flex items-center space-x-2 mb-2'>
                <div className='p-1.5 bg-blue-100 rounded-lg'>
                  <Video className='w-4 h-4 text-blue-600' />
                </div>
                <span className='text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors'>
                  Auto-Generate Videos
                </span>
                {videoSettings.autoGenerateVideo && (
                  <div className='px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium'>
                    Active
                  </div>
                )}
              </div>
              <p className='text-xs text-gray-600 leading-relaxed'>
                Automatically generate synchronized videos after TTS creation
              </p>
              {videoSettings.autoGenerateVideo && (
                <div className='mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg'>
                  <p className='text-xs text-blue-700'>
                    ✓ Videos will be synchronized automatically after TTS
                    generation
                  </p>
                </div>
              )}
            </div>
          </label>
        </div>
      </div>

      {/* Workflow Status */}
      {(videoSettings.autoGenerateTTS || videoSettings.autoGenerateVideo) && (
        <div className='mt-6 p-4 bg-gradient-to-r from-green-50 to-teal-50 border border-green-200 rounded-xl'>
          <div className='flex items-center space-x-2 mb-2'>
            <div className='w-2 h-2 bg-green-500 rounded-full'></div>
            <span className='text-sm font-medium text-green-800'>
              Automation Workflow Active
            </span>
          </div>
          <div className='text-xs text-green-700 space-y-1'>
            {videoSettings.autoGenerateTTS && (
              <p>• Text edits → Auto TTS generation</p>
            )}
            {videoSettings.autoGenerateVideo && (
              <p>• TTS creation → Auto video synchronization</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
