'use client';

import React, { useState } from 'react';
import { Film, Download, ExternalLink, X } from 'lucide-react';

interface MergedVideoDisplayProps {
  mergedVideo: {
    url: string | null;
    fileName: string | null;
    createdAt: Date | null;
  };
  onClear?: () => void;
}

export default function MergedVideoDisplay({
  mergedVideo,
  onClear,
}: MergedVideoDisplayProps) {
  const [showPlayer, setShowPlayer] = useState(false);
  console.log('MergedVideoDisplay rendering with:', mergedVideo);

  // Don't render if no URL
  if (!mergedVideo.url) {
    console.log('MergedVideoDisplay: No URL, not rendering');
    return null;
  }

  console.log('MergedVideoDisplay: Rendering with URL:', mergedVideo.url);

  return (
    <div className='bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg p-6 border border-green-200 mb-6'>
      <div className='flex items-start justify-between'>
        <div className='flex-1'>
          <div className='flex items-center gap-3 mb-4'>
            <div className='p-2 bg-emerald-500 rounded-lg'>
              <Film className='w-5 h-5 text-white' />
            </div>
            <div>
              <h3 className='font-semibold text-emerald-900 text-lg'>
                Merged Video Ready
              </h3>
              <p className='text-sm text-emerald-700'>
                Created{' '}
                {mergedVideo.createdAt
                  ? new Date(mergedVideo.createdAt).toLocaleString()
                  : 'now'}
              </p>
            </div>
          </div>

          {/* Video Player Section */}
          <div className='bg-white rounded-lg p-4 border border-emerald-200 mb-4'>
            <div className='flex items-center justify-between mb-3'>
              <p className='text-sm text-gray-600 font-medium'>
                {mergedVideo.fileName}
              </p>
              <div className='flex items-center gap-2'>
                <button
                  onClick={() => setShowPlayer(!showPlayer)}
                  className='text-emerald-600 hover:text-emerald-800 text-sm font-medium'
                >
                  {showPlayer ? 'Hide Player' : 'Show Player'}
                </button>
                {onClear && (
                  <button
                    onClick={onClear}
                    className='text-gray-400 hover:text-gray-600 text-sm'
                    title='Clear merged video'
                  >
                    <X className='w-4 h-4' />
                  </button>
                )}
              </div>
            </div>

            {showPlayer && (
              <div className='mt-3'>
                <video
                  controls
                  className='w-full max-h-96 rounded-lg border border-gray-200'
                  src={mergedVideo.url}
                  preload='metadata'
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className='flex items-center gap-3'>
            <a
              href={mergedVideo.url}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
            >
              <Download className='w-4 h-4' />
              Download
            </a>
            <a
              href={mergedVideo.url}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 text-emerald-700 font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md border border-emerald-200'
            >
              <ExternalLink className='w-4 h-4' />
              Open in New Tab
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
