import React, { useState } from 'react';
import { Video, ExternalLink, Check, Mic } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { playSuccessSound } from '@/utils/soundManager';

const FinalVideoTable: React.FC = () => {
  const [transcribing, setTranscribing] = useState(false);
  const { transcriptionSettings } = useAppStore();

  const finalVideoData = localStorage.getItem('final-video-data');
  let parsedData = null;

  if (finalVideoData) {
    try {
      parsedData = JSON.parse(finalVideoData);
    } catch (error) {
      console.warn('Failed to parse final video data:', error);
    }
  }

  const handleTranscribeVideo = async () => {
    if (!parsedData?.finalVideoUrl) return;

    try {
      setTranscribing(true);

      const response = await fetch('/api/transcribe-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_url: parsedData.finalVideoUrl,
          model: transcriptionSettings.selectedModel,
        }),
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const result = await response.json();

      // Step 2: Process the response to extract word timestamps
      const wordTimestamps = [];
      const segments = result.response?.segments;

      if (segments && segments.length > 0) {
        for (const segment of segments) {
          if (segment.words) {
            for (const wordObj of segment.words) {
              wordTimestamps.push({
                word: wordObj.word.trim(),
                start: wordObj.start,
                end: wordObj.end,
              });
            }
          }
        }
      }

      // Step 3: Upload the captions file to MinIO
      const captionsData = JSON.stringify(wordTimestamps);
      const filename = `final_video_captions_${Date.now()}.json`;

      const formData = new FormData();
      const blob = new Blob([captionsData], { type: 'application/json' });
      formData.append('file', blob, filename);

      const uploadResponse = await fetch('/api/upload-captions', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload captions');
      }

      const uploadResult = await uploadResponse.json();
      console.log('Captions uploaded successfully:', uploadResult);

      // Step 4: Save transcription result to localStorage with captions URL
      const existingData = localStorage.getItem('final-video-data');
      let dataObject = {};

      if (existingData) {
        try {
          dataObject = JSON.parse(existingData);
        } catch (parseError) {
          dataObject = {};
        }
      }

      // Update with transcription result and captions URL
      const captionsUrl = uploadResult.url || uploadResult.file_url;
      const updatedData = {
        ...dataObject,
        caption: 'Transcription completed',
        captionsUrl: captionsUrl,
        transcribedAt: new Date().toISOString(),
      };

      localStorage.setItem('final-video-data', JSON.stringify(updatedData));
      console.log('Transcription saved to localStorage:', result);

      // Force re-render by updating state (this will cause the component to re-render with new data)
      window.location.reload();
    } catch (error) {
      console.error('Error transcribing video:', error);
      alert('Failed to transcribe video. Please try again.');
    } finally {
      setTranscribing(false);
      //   add a sound notification here if desired
      playSuccessSound();
    }
  };

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
                  {parsedData.captionsUrl ? (
                    <div className='flex items-center gap-2'>
                      <span className='text-green-600 font-medium'>
                        Transcribed
                      </span>
                      <button
                        onClick={() =>
                          window.open(parsedData.captionsUrl, '_blank')
                        }
                        className='inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors'
                        title='Download captions file'
                      >
                        <Check className='w-3 h-3' />
                        Captions
                      </button>
                    </div>
                  ) : parsedData.caption === 'Transcription completed' ? (
                    <span className='text-green-600 font-medium'>
                      Transcribed
                    </span>
                  ) : parsedData.videoCount ? (
                    `${parsedData.videoCount} videos merged`
                  ) : (
                    'No caption available'
                  )}
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
                  <button
                    onClick={handleTranscribeVideo}
                    disabled={transcribing}
                    className='inline-flex items-center gap-1 px-3 py-1 text-sm bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white rounded-md transition-colors disabled:cursor-not-allowed'
                    title='Transcribe video'
                  >
                    <Mic
                      className={`w-3 h-3 ${
                        transcribing ? 'animate-pulse' : ''
                      }`}
                    />
                    {transcribing ? 'Transcribing...' : 'Transcribe'}
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
