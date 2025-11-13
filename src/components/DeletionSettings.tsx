'use client';

import { useAppStore } from '@/store/useAppStore';
import { Trash2, Shield } from 'lucide-react';

export default function DeletionSettings() {
  const { deletionSettings, updateDeletionSettings } = useAppStore();

  return (
    <div className='mb-6 p-4 sm:p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header */}
      <div className='flex items-center space-x-3 mb-6'>
        <div className='p-2 bg-gradient-to-br from-red-500 to-pink-600 rounded-lg shadow-sm'>
          <Trash2 className='w-5 h-5 text-white' />
        </div>
        <div>
          <h3 className='text-lg font-semibold text-gray-900 mb-1'>
            Deletion Settings
          </h3>
        </div>
      </div>

      {/* Settings - Vertical Stack */}
      <div className='flex flex-col space-y-4'>
        {/* Prefix Cleanup Toggle */}
        <div className='relative'>
          <label className='flex items-start space-x-4 cursor-pointer group'>
            <div className='relative flex-shrink-0 mt-1'>
              <input
                type='checkbox'
                checked={deletionSettings.enablePrefixCleanup}
                onChange={(e) =>
                  updateDeletionSettings({
                    enablePrefixCleanup: e.target.checked,
                  })
                }
                className='w-5 h-5 text-red-600 bg-white border-2 border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors duration-200'
              />
            </div>
            <div className='flex-1 min-w-0'>
              <div className='flex items-center space-x-2 mb-2'>
                <div className='p-1.5 bg-red-100 rounded-lg'>
                  <Shield className='w-4 h-4 text-red-600' />
                </div>
                <span className='text-sm font-semibold text-gray-900 group-hover:text-red-700 transition-colors'>
                  Extra Prefix-Based Cleanup
                </span>
                {deletionSettings.enablePrefixCleanup && (
                  <div className='px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium'>
                    Active
                  </div>
                )}
              </div>
              <p className='text-xs text-gray-600 leading-relaxed'>
                {deletionSettings.enablePrefixCleanup
                  ? 'Scans MinIO storage for orphaned files starting with the video ID and removes them for thorough cleanup.'
                  : 'Only deletes files directly referenced in Baserow fields. Enable for comprehensive storage cleanup.'}
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
