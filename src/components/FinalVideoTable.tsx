import React, { useState } from 'react';
import { Video, ExternalLink, Check, Mic, Sparkles, Clock } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { playSuccessSound } from '@/utils/soundManager';

const FinalVideoTable: React.FC = () => {
  const [transcribing, setTranscribing] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [generatingTimestamps, setGeneratingTimestamps] = useState(false);
  const [videoData, setVideoData] = useState<any>(null);
  const [timestampData, setTimestampData] = useState<string>('');

  const { transcriptionSettings, modelSelection } = useAppStore();

  // Load data from localStorage on mount and when it changes
  React.useEffect(() => {
    const loadData = () => {
      const finalVideoData = localStorage.getItem('final-video-data');
      const timestampData = localStorage.getItem('timestamp');

      if (finalVideoData) {
        try {
          const parsed = JSON.parse(finalVideoData);
          console.log(
            'Loaded description from localStorage:',
            parsed.description
          );
          console.log(
            'Description with line breaks visible:',
            JSON.stringify(parsed.description)
          );
          console.log('Description length:', parsed.description?.length);

          // Handle timestamps from final-video-data object
          if (parsed.timestamp) {
            if (typeof parsed.timestamp === 'string') {
              parsed.timestamps = parsed.timestamp
                .split('\n')
                .filter((t: string) => t.trim());
            } else if (Array.isArray(parsed.timestamp)) {
              parsed.timestamps = parsed.timestamp;
            }
          }

          // Merge timestamp data if available
          if (timestampData) {
            try {
              // Try to parse as JSON first (for array format)
              const timestamps = JSON.parse(timestampData);
              if (Array.isArray(timestamps)) {
                parsed.timestamps = timestamps;
              } else {
                // If it's a string, split by newlines
                parsed.timestamps = timestampData
                  .split('\n')
                  .filter((t) => t.trim());
              }
            } catch (error) {
              // If JSON parsing fails, treat as newline-separated string
              parsed.timestamps = timestampData
                .split('\n')
                .filter((t: string) => t.trim());
            }
          }

          setVideoData(parsed);
        } catch (error) {
          console.warn('Failed to parse final video data:', error);
          setVideoData(null);
        }
      } else {
        setVideoData(null);
      }

      // Set timestamp data for display
      if (finalVideoData) {
        try {
          const parsed = JSON.parse(finalVideoData);
          setTimestampData(parsed.timestamp || '');
        } catch (error) {
          setTimestampData('');
        }
      } else {
        setTimestampData('');
      }
    };

    loadData();

    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'final-video-data' || e.key === 'timestamp') {
        loadData();
      }
    };

    // Listen for custom storage events (for same-tab updates)
    const handleCustomStorageChange = () => {
      loadData();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageUpdate', handleCustomStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(
        'localStorageUpdate',
        handleCustomStorageChange
      );
    };
  }, []);

  const parsedData = videoData;

  const handleResetData = () => {
    try {
      const existingData = localStorage.getItem('final-video-data');
      if (existingData) {
        const parsed = JSON.parse(existingData);
        // Keep only finalVideoUrl and timestamp, set everything else to empty string
        const resetData = {
          finalVideoUrl: parsed.finalVideoUrl || '',
          timestamp: parsed.timestamp || '',
          caption: '',
          captionsUrl: '',
          title: '',
          description: '',
          createdAt: '',
          videoCount: '',
          transcribedAt: '',
          titleGeneratedAt: '',
          descriptionGeneratedAt: '',
          mergedAt: '',
          lastUpdated: new Date().toISOString(),
        };

        localStorage.setItem('final-video-data', JSON.stringify(resetData));

        // Dispatch custom event to notify other components
        window.dispatchEvent(new CustomEvent('localStorageUpdate'));

        // Update local state
        setVideoData(resetData);
        setTimestampData('');

        console.log(
          'Data reset successfully, kept finalVideoUrl and timestamp:',
          parsed.finalVideoUrl,
          parsed.timestamp
        );
      }
    } catch (error) {
      console.error('Error resetting data:', error);
      alert('Failed to reset data. Please try again.');
    }
  };

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
      let dataObject: any = {};

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
        lastUpdated: new Date().toISOString(),
      };

      localStorage.setItem('final-video-data', JSON.stringify(updatedData));
      console.log('Transcription saved to localStorage:', result);

      // Dispatch custom event to notify other components of localStorage update
      window.dispatchEvent(new CustomEvent('localStorageUpdate'));

      // Update local state to trigger re-render
      setVideoData(updatedData);

      playSuccessSound();
    } catch (error) {
      console.error('Error transcribing video:', error);
      alert('Failed to transcribe video. Please try again.');
    } finally {
      setTranscribing(false);
    }
  };

  const handleGenerateTitle = async () => {
    if (!parsedData?.captionsUrl) {
      alert('No transcription available. Please transcribe the video first.');
      return;
    }

    try {
      setGeneratingTitle(true);

      // Fetch the transcription from the captions URL
      const transcriptionResponse = await fetch(parsedData.captionsUrl);
      if (!transcriptionResponse.ok) {
        throw new Error('Failed to fetch transcription');
      }

      const transcriptionData = await transcriptionResponse.json();

      // Extract text from word timestamps
      const transcriptionText = transcriptionData
        .map((word: any) => word.word)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      console.log(
        'Generating title for transcription:',
        transcriptionText.substring(0, 100) + '...'
      );

      // Call the new title generation API
      const response = await fetch('/api/generate-title', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptionText: transcriptionText,
          model: modelSelection.selectedModel,
        }),
      });

      if (!response.ok) {
        throw new Error('Title generation failed');
      }

      const result = await response.json();
      const generatedTitle = result.title || 'Generated Title';

      // Save the generated title to localStorage
      const existingData = localStorage.getItem('final-video-data');
      let dataObject: any = {};

      if (existingData) {
        try {
          dataObject = JSON.parse(existingData);
        } catch (parseError) {
          dataObject = {};
        }
      }

      // Update with generated title
      const updatedData = {
        ...dataObject,
        title: generatedTitle,
        titleGeneratedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };

      localStorage.setItem('final-video-data', JSON.stringify(updatedData));
      console.log('Title saved to localStorage:', generatedTitle);

      // Dispatch custom event to notify other components of localStorage update
      window.dispatchEvent(new CustomEvent('localStorageUpdate'));

      // Update local state to trigger re-render
      setVideoData(updatedData);

      playSuccessSound();
    } catch (error) {
      console.error('Error generating title:', error);
      alert('Failed to generate title. Please try again.');
    } finally {
      setGeneratingTitle(false);
    }
  };

  const handleGenerateDescription = async () => {
    if (!parsedData?.captionsUrl) {
      alert('No transcription available. Please transcribe the video first.');
      return;
    }

    try {
      setGeneratingDescription(true);

      // Fetch the transcription from the captions URL
      const transcriptionResponse = await fetch(parsedData.captionsUrl);
      if (!transcriptionResponse.ok) {
        throw new Error('Failed to fetch transcription');
      }

      const transcriptionData = await transcriptionResponse.json();

      // Extract text from word timestamps
      const transcriptionText = transcriptionData
        .map((word: any) => word.word)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      console.log(
        'Generating description for transcription:',
        transcriptionText.substring(0, 100) + '...'
      );

      // Call the new description generation API
      const response = await fetch('/api/generate-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptionText: transcriptionText,
          model: modelSelection.selectedModel,
        }),
      });

      if (!response.ok) {
        throw new Error('Description generation failed');
      }

      const result = await response.json();
      console.log('AI Response:', result);

      let generatedDescription = result.description || 'Generated Description';

      console.log('Raw generated description:', generatedDescription);
      console.log('Formatted description:', generatedDescription);

      // Check if AI already provided proper paragraph formatting
      if (
        generatedDescription.includes('\n\n') ||
        generatedDescription.includes('\n')
      ) {
        // AI provided formatting - clean it up but preserve structure
        generatedDescription = generatedDescription
          .replace(/\n\n\n+/g, '\n') // Remove excessive line breaks
          .replace(/\n/g, '\n') // Ensure double line breaks
          .trim();
        console.log('Using AI-provided formatting');
      } else {
        // AI didn't provide formatting - apply our own paragraph logic
        console.log('Applying post-processing formatting');
        const sentences = generatedDescription
          .split(/[.!?]+/)
          .filter((s: string) => s.trim().length > 0);

        if (sentences.length <= 3) {
          // If few sentences, keep as is but ensure some breaks
          generatedDescription = sentences.join('. ') + '.';
        } else {
          // Break into logical paragraphs
          const introEnd = Math.min(2, Math.floor(sentences.length * 0.3));
          const mainEnd = Math.floor(sentences.length * 0.7);

          const intro = sentences.slice(0, introEnd).join('. ').trim() + '.';
          const main =
            sentences.slice(introEnd, mainEnd).join('. ').trim() + '.';
          const cta = sentences.slice(mainEnd).join('. ').trim() + '.';

          generatedDescription = [intro, main, cta]
            .filter((p) => p.length > 10)
            .join('\n');
        }
      }

      console.log('Final formatted description:', generatedDescription);
      console.log('Description split test:', generatedDescription.split('\n'));

      // Save the generated description to localStorage
      const existingData = localStorage.getItem('final-video-data');
      let dataObject: any = {};

      if (existingData) {
        try {
          dataObject = JSON.parse(existingData);
        } catch (parseError) {
          dataObject = {};
        }
      }

      // Update with generated description
      const updatedData = {
        ...dataObject,
        description: generatedDescription,
        descriptionGeneratedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };

      localStorage.setItem('final-video-data', JSON.stringify(updatedData));
      console.log('Description saved to localStorage:', generatedDescription);
      console.log(
        'Description with line breaks visible:',
        JSON.stringify(generatedDescription)
      );
      console.log('Raw description in updatedData:', updatedData.description);

      // Dispatch custom event to notify other components of localStorage update
      window.dispatchEvent(new CustomEvent('localStorageUpdate'));

      // Update local state to trigger re-render
      setVideoData(updatedData);

      playSuccessSound();
    } catch (error) {
      console.error('Error generating description:', error);
      alert('Failed to generate description. Please try again.');
    } finally {
      setGeneratingDescription(false);
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
                  {parsedData.title || 'Final Merged Video'}
                </div>
                <div className='text-sm text-gray-500'>
                  {parsedData.mergedAt
                    ? new Date(parsedData.mergedAt).toLocaleDateString()
                    : 'Unknown date'}
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
                  <button
                    onClick={handleGenerateTitle}
                    disabled={generatingTitle || !parsedData.captionsUrl}
                    className='inline-flex items-center gap-1 px-3 py-1 text-sm bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white rounded-md transition-colors disabled:cursor-not-allowed'
                    title={
                      parsedData.captionsUrl
                        ? 'Generate YouTube title from transcription'
                        : 'Transcription required for title generation'
                    }
                  >
                    <Sparkles
                      className={`w-3 h-3 ${
                        generatingTitle ? 'animate-pulse' : ''
                      }`}
                    />
                    {generatingTitle ? 'Generating...' : 'Generate Title'}
                  </button>
                  <button
                    onClick={handleGenerateDescription}
                    disabled={generatingDescription || !parsedData.captionsUrl}
                    className='inline-flex items-center gap-1 px-3 py-1 text-sm bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white rounded-md transition-colors disabled:cursor-not-allowed'
                    title={
                      parsedData.captionsUrl
                        ? 'Generate YouTube description from transcription'
                        : 'Transcription required for description generation'
                    }
                  >
                    <Sparkles
                      className={`w-3 h-3 ${
                        generatingDescription ? 'animate-pulse' : ''
                      }`}
                    />
                    {generatingDescription
                      ? 'Generating...'
                      : 'Generate Description'}
                  </button>
                  <button
                    onClick={handleResetData}
                    className='inline-flex items-center gap-1 px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors'
                    title='Reset all data except final video URL and timestamps'
                  >
                    Reset Data
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Video Description and Timestamps Section */}
      {timestampData && (
        <div className='mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4'>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-lg font-semibold text-gray-900 flex items-center gap-2'>
              <Clock className='w-5 h-5 text-teal-500' />
              Video Title, Description & Timestamps
            </h3>
            <button
              onClick={() => {
                const finalVideoData = localStorage.getItem('final-video-data');
                let description = '';
                let title = parsedData.title || 'Final Merged Video';
                if (finalVideoData) {
                  try {
                    const parsed = JSON.parse(finalVideoData);
                    description = parsed.description || '';
                  } catch (error) {
                    console.warn('Failed to parse final video data:', error);
                  }
                }
                const fullContent = `${title}\n\n${description}\n\ntimestamp:\n${timestampData}`;
                navigator.clipboard.writeText(fullContent);
                // Could add a toast notification here
              }}
              className='px-3 py-1 text-sm bg-teal-500 hover:bg-teal-600 text-white rounded-md transition-colors'
              title='Copy description and timestamps to clipboard'
            >
              Copy All
            </button>
          </div>
          <div className='bg-white border border-gray-200 rounded-md p-3'>
            <div className='space-y-4'>
              {/* Description Section */}
              <div>
                <h4 className='text-sm font-medium text-gray-900 mb-2'>
                  Description
                </h4>
                <div className='text-sm text-gray-700 bg-gray-50 p-3 rounded-md'>
                  {(() => {
                    const finalVideoData =
                      localStorage.getItem('final-video-data');
                    if (finalVideoData) {
                      try {
                        const parsed = JSON.parse(finalVideoData);
                        return (
                          parsed.description || 'No description generated yet'
                        );
                      } catch (error) {
                        console.warn(
                          'Failed to parse final video data:',
                          error
                        );
                        return 'No description generated yet';
                      }
                    }
                    return 'No description generated yet';
                  })()}
                </div>
              </div>

              {/* Timestamp Section */}
              <div>
                <h4 className='text-sm font-medium text-gray-900 mb-2'>
                  Timestamps
                </h4>
                <pre className='text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-3 rounded-md'>
                  {timestampData}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinalVideoTable;
