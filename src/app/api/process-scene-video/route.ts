import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeAudioLoudness,
  normalizeAudioWithUpload,
} from '@/utils/ffmpeg-normalize';
import { convertToCFR, convertToCFRWithUpload } from '@/utils/ffmpeg-cfr';
import { optimizeSilence } from '@/utils/ffmpeg-silence';
import { uploadToMinio } from '@/utils/ffmpeg-cfr';
import path from 'path';
import { writeFile, unlink } from 'fs/promises';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const sceneId = formData.get('sceneId') as string;
    const videoId = formData.get('videoId') as string;
    const applyNormalize = formData.get('applyNormalize') === 'true';
    const applyCfr = formData.get('applyCfr') === 'true';
    const applySilence = formData.get('applySilence') === 'true';
    const applyTranscribe = formData.get('applyTranscribe') === 'true';
    const transcriptionModel = formData.get('transcriptionModel') as string;
    const transcriptionVideoType = formData.get(
      'transcriptionVideoType'
    ) as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!sceneId || !videoId) {
      return NextResponse.json(
        { error: 'Scene ID and Video ID are required' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith('video/')) {
      return NextResponse.json(
        { error: 'File must be a video' },
        { status: 400 }
      );
    }

    // Validate file size (max 10GB)
    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size must be less than 10GB' },
        { status: 400 }
      );
    }

    console.log(`Processing scene video: ${file.name}, size: ${file.size}`);
    console.log(`Scene ID: ${sceneId}, Video ID: ${videoId}`);
    console.log(
      `Apply normalize: ${applyNormalize}, Apply CFR: ${applyCfr}, Apply silence: ${applySilence}, Apply transcribe: ${applyTranscribe}`
    );
    if (applyTranscribe) {
      console.log(
        `Transcription model: ${transcriptionModel}, Video type: ${transcriptionVideoType}`
      );
    }

    // Convert file to buffer and save temporarily
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create temporary input file
    const timestamp = Date.now();
    const inputFileName = `input_${sceneId}_${timestamp}.mp4`;
    const inputPath = path.resolve('/tmp', inputFileName);

    // Write buffer to temp file
    await writeFile(inputPath, buffer);

    let currentPath = inputPath;
    let finalPath = inputPath;

    try {
      // Step 1: Apply normalization if requested
      if (applyNormalize) {
        console.log('Applying audio normalization...');
        const normalizedPath = await normalizeAudioLoudness({
          inputUrl: currentPath,
          targetLoudness: -19,
          loudnessRange: 7,
          truePeak: -2,
        });

        // Clean up previous file if different
        if (currentPath !== inputPath) {
          try {
            await unlink(currentPath);
          } catch (cleanupError) {
            console.warn(
              `Failed to cleanup intermediate file: ${cleanupError}`
            );
          }
        }

        currentPath = normalizedPath;
        finalPath = normalizedPath;
        console.log('Audio normalization completed');
      }

      // Step 2: Apply CFR conversion if requested
      if (applyCfr) {
        console.log('Applying CFR conversion...');
        const cfrPath = await convertToCFR({
          inputUrl: currentPath,
          framerate: 30,
        });

        // Clean up previous file if different
        if (currentPath !== inputPath) {
          try {
            await unlink(currentPath);
          } catch (cleanupError) {
            console.warn(
              `Failed to cleanup intermediate file: ${cleanupError}`
            );
          }
        }

        currentPath = cfrPath;
        finalPath = cfrPath;
        console.log('CFR conversion completed');
      }

      // Step 3: Apply silence optimization if requested
      if (applySilence) {
        console.log('Applying silence optimization...');
        const result = await optimizeSilence({
          inputUrl: currentPath,
          soundLevel: -30,
          minSilenceLength: 0.5,
          speedRate: 4,
        });
        const silencePath = result.outputPath;

        // Clean up previous file if different
        if (currentPath !== inputPath) {
          try {
            await unlink(currentPath);
          } catch (cleanupError) {
            console.warn(
              `Failed to cleanup intermediate file: ${cleanupError}`
            );
          }
        }

        currentPath = silencePath;
        finalPath = silencePath;
        console.log('Silence optimization completed');
      }

      // Step 4: Upload the final processed video to MinIO
      console.log('Uploading processed video to MinIO...');
      const filename = `video_${videoId}_scene_${sceneId}_processed_${timestamp}.mp4`;
      const uploadUrl = await uploadToMinio(finalPath, filename, 'video/mp4');

      console.log('Scene video processed and uploaded successfully:', filename);

      // Step 5: Transcribe the video if requested
      if (applyTranscribe) {
        console.log('Starting transcription for uploaded video...');
        try {
          const transcribeResponse = await fetch(
            `${
              process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
            }/api/transcribe-scene`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                media_url: uploadUrl,
                model: transcriptionModel,
                scene_id: parseInt(sceneId),
              }),
            }
          );

          if (!transcribeResponse.ok) {
            console.warn(
              'Transcription failed, but video processing succeeded'
            );
          } else {
            console.log('Transcription completed successfully');

            // Process transcription response
            const transcriptionData = await transcribeResponse.json();

            // Step 1: Process the response to extract word timestamps
            const wordTimestamps = [];
            const segments = transcriptionData.response?.segments;

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

            // Step 2: Upload the captions file to MinIO
            const captionsData = JSON.stringify(wordTimestamps);
            const timestamp = Date.now();
            const filename = `scene_${sceneId}_captions_${timestamp}.json`;

            const formData = new FormData();
            const blob = new Blob([captionsData], { type: 'application/json' });
            formData.append('file', blob, filename);

            const uploadResponse = await fetch(
              `${
                process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
              }/api/upload-captions`,
              {
                method: 'POST',
                body: formData,
              }
            );

            if (!uploadResponse.ok) {
              console.warn('Failed to upload scene captions');
            } else {
              const uploadResult = await uploadResponse.json();
              console.log(
                'Scene captions uploaded successfully:',
                uploadResult
              );

              // Step 3: Extract full text from transcription
              const fullText = wordTimestamps
                .map((word) => word.word)
                .join(' ');
              console.log('Extracted full text from transcription:', fullText);

              // Step 4: Update the scene record with the captions URL and transcribed text
              const captionsUrl = uploadResult.url || uploadResult.file_url;
              if (captionsUrl) {
                const updateData: Record<string, unknown> = {
                  field_6910: captionsUrl, // Captions URL for Scene field
                };

                // Only update the sentence if we have extracted text
                if (fullText.trim()) {
                  updateData.field_6890 = fullText.trim(); // Update Sentence field with transcribed text
                  console.log('Updating scene sentence with transcribed text');
                }

                // Import and use the updateSceneRow server action
                const { updateSceneRow } = await import(
                  '@/lib/baserow-actions'
                );

                try {
                  await updateSceneRow(parseInt(sceneId), updateData);
                  console.log(
                    'Scene updated successfully with transcription data'
                  );
                } catch (updateError) {
                  console.warn(
                    'Failed to update scene with transcription data:',
                    updateError
                  );
                }
              }
            }
          }
        } catch (transcribeError) {
          console.warn('Transcription error:', transcribeError);
          // Don't fail the whole process if transcription fails
        }
      }

      // Clean up final file
      try {
        await unlink(finalPath);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup final file: ${cleanupError}`);
      }

      return NextResponse.json({
        success: true,
        videoUrl: uploadUrl,
        filename,
        message: 'Scene video processed and uploaded successfully',
        processing: {
          normalized: applyNormalize,
          cfr: applyCfr,
          silence: applySilence,
          transcribed: applyTranscribe,
        },
      });
    } catch (processingError) {
      console.error('Processing failed:', processingError);

      // If processing failed but we have the original file, try uploading it as-is
      if (finalPath === inputPath) {
        console.log('Uploading original file as fallback...');
        try {
          const filename = `video_${videoId}_scene_${sceneId}_raw_${timestamp}.mp4`;
          const uploadUrl = await uploadToMinio(
            finalPath,
            filename,
            'video/mp4'
          );

          return NextResponse.json({
            success: true,
            videoUrl: uploadUrl,
            filename,
            message: 'Original video uploaded (processing failed)',
            processing: {
              normalized: false,
              cfr: false,
              error:
                processingError instanceof Error
                  ? processingError.message
                  : 'Unknown error',
            },
          });
        } catch (uploadError) {
          console.error('Fallback upload also failed:', uploadError);
        }
      }

      throw processingError;
    } finally {
      // Clean up input file
      try {
        await unlink(inputPath);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup input file: ${cleanupError}`);
      }
    }
  } catch (error) {
    console.error('Error processing scene video:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Processing failed',
      },
      { status: 500 }
    );
  }
}
