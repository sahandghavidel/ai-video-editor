import React from 'react';
import { Video, ExternalLink, Check } from 'lucide-react';

const FinalVideoTable: React.FC = () => {
  const finalVideoData = localStorage.getItem('final-video-data');
  let parsedData = null;

  if (finalVideoData) {
    try {
      parsedData = JSON.parse(finalVideoData);
    } catch (error) {
      console.warn('Failed to parse final video data:', error);
    }
  }

  if (!parsedData || !parsedData.finalVideoUrl) {
    return null;
  }

  return (
    <div className='mt-6 bg-white border border-gray-200 rounded-lg shadow-sm'>
      <div className='px-6 py-4 border-b border-gray-200'>
        <h3 className='text-lg font-semibold text-gray-900 flex items-center gap-2'>
          <Video className='w-5 h-5 text-blue-500' />
          Final Video
        </h3>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
                Title
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
                Video URL
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
                Caption
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className='bg-white divide-y divide-gray-200'>
            <tr className='hover:bg-gray-50'>
              <td className='px-6 py-4 whitespace-nowrap'>
                <div className='text-sm font-medium text-gray-900'>
                  Final Merged Video
                </div>
                <div className='text-sm text-gray-500'>
                  {parsedData.mergedAt
                    ? new Date(parsedData.mergedAt).toLocaleDateString()
                    : 'Unknown date'}
                </div>
              </td>
              <td className='px-6 py-4 whitespace-nowrap'>
                <div
                  className='text-sm text-gray-900 max-w-xs truncate'
                  title={parsedData.finalVideoUrl}
                >
                  {parsedData.finalVideoUrl}
                </div>
              </td>
              <td className='px-6 py-4 whitespace-nowrap'>
                <div className='text-sm text-gray-500'>
                  {parsedData.videoCount
                    ? `${parsedData.videoCount} videos merged`
                    : 'No caption available'}
                </div>
              </td>
              <td className='px-6 py-4 whitespace-nowrap'>
                <div className='flex items-center gap-2'>
                  <button
                    onClick={() =>
                      window.open(parsedData.finalVideoUrl, '_blank')
                    }
                    className='inline-flex items-center gap-1 px-3 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors'
                    title='Open video in new tab'
                  >
                    <ExternalLink className='w-3 h-3' />
                    View
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(parsedData.finalVideoUrl);
                      // Could add a toast notification here
                    }}
                    className='inline-flex items-center gap-1 px-3 py-1 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors'
                    title='Copy video URL'
                  >
                    <Check className='w-3 h-3' />
                    Copy
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FinalVideoTable;
