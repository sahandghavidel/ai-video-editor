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
            Auto-Generation
          </h3>
        </div>
      </div>

      {/* Settings - Vertical Stack */}
      <div className='flex flex-col space-y-4'>
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
                  TTS
                </span>
                {videoSettings.autoGenerateTTS && (
                  <div className='px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium'>
                    Active
                  </div>
                )}
              </div>
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
                  Video
                </span>
                {videoSettings.autoGenerateVideo && (
                  <div className='px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium'>
                    Active
                  </div>
                )}
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
