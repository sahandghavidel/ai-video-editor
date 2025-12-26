import { NextRequest, NextResponse } from 'next/server';

interface SceneSegment {
  id: number;
  words: string;
  duration: number;
  startTime: number;
  endTime: number;
  preEndTime: number;
  type: 'sentence' | 'gap';
  videoId: string;
}

interface WordSegment {
  word: string;
  start: number;
  end: number;
}

type TranscriptionData =
  | WordSegment[]
  | { Segments: WordSegment[] }
  | { segments: WordSegment[] }
  | { words: WordSegment[] };

export async function POST(request: NextRequest) {
  try {
    const {
      videoId,
      captionsUrl,
      videoDuration: rawVideoDuration,
    } = await request.json();

    if (!videoId || !captionsUrl) {
      return NextResponse.json(
        { error: 'Video ID and captions URL are required' },
        { status: 400 }
      );
    }

    // Convert videoDuration to number if it's a string
    let videoDuration: number | undefined = undefined;
    if (rawVideoDuration !== null && rawVideoDuration !== undefined) {
      const parsed =
        typeof rawVideoDuration === 'number'
          ? rawVideoDuration
          : parseFloat(rawVideoDuration);

      if (!isNaN(parsed)) {
        videoDuration = parsed;
      }
    }

    console.log('Generating scenes for video:', videoId);
    console.log('Captions URL:', captionsUrl);
    console.log('Video Duration:', videoDuration || 'not provided');

    // Step 1: Fetch the captions/transcription JSON
    const captionsResponse = await fetch(captionsUrl);
    if (!captionsResponse.ok) {
      throw new Error(
        `Failed to fetch captions: ${captionsResponse.statusText}`
      );
    }

    const captionsData = await captionsResponse.json();
    console.log(
      'Fetched captions data - length:',
      Array.isArray(captionsData) ? captionsData.length : 'not array'
    );

    // Step 2: Split into sentences and gaps
    const scenes = generateScenesFromTranscription(
      captionsData,
      videoId,
      videoDuration
    );
    console.log(`Generated ${scenes.length} scenes`);

    // Step 3: Create all scene records in Baserow using batch operation
    console.log(`Creating ${scenes.length} scenes in batch...`);
    const createdScenes = await createSceneRecordsBatch(scenes);
    const sceneIds = createdScenes.map((scene: { id: number }) => scene.id);

    // Step 4: Update the original video record with scene IDs
    console.log(
      `Updating original video ${videoId} with ${sceneIds.length} scene IDs:`,
      sceneIds
    );
    await updateOriginalVideoWithScenes(videoId, sceneIds);

    return NextResponse.json({
      success: true,
      message: `Successfully generated ${createdScenes.length} scenes and linked them to video ${videoId}`,
      scenes: createdScenes,
      sceneIds: sceneIds,
    });
  } catch (error) {
    console.error('Error generating scenes:', error);
    return NextResponse.json(
      {
        error: `Failed to generate scenes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      { status: 500 }
    );
  }
}

// Function to split transcription into sentences and gaps
function generateScenesFromTranscription(
  transcriptionData: TranscriptionData,
  videoId: string,
  videoDuration?: number
): SceneSegment[] {
  // Handle different data structures
  let segments: WordSegment[] = [];

  if (Array.isArray(transcriptionData)) {
    // Direct array of word objects
    segments = transcriptionData;
  } else if ('Segments' in transcriptionData) {
    segments = transcriptionData.Segments;
  } else if ('segments' in transcriptionData) {
    segments = transcriptionData.segments;
  } else if ('words' in transcriptionData) {
    segments = transcriptionData.words;
  }

  console.log(
    'Processing',
    segments.length,
    'word segments into sentences and gaps'
  );

  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error(
      `No segments found in transcription data. Available keys: ${Object.keys(
        transcriptionData || {}
      ).join(', ')}`
    );
  }

  // Function to detect sentence endings
  function isSentenceEnd(word: string): boolean {
    const abbreviations = [
      'mr',
      'mrs',
      'dr',
      'prof',
      'sr',
      'jr',
      'vs',
      'etc',
      'inc',
      'ltd',
      'co',
      'st',
      'ave',
      'blvd',
    ];
    const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');

    if (abbreviations.includes(cleanWord)) {
      return false;
    }

    return /[.!?]$/.test(word.trim());
  }

  // Process words to create sentence segments
  const processedSegments: SceneSegment[] = [];
  let currentSegment = {
    id: 0,
    words: '',
    startTime: null as number | null,
    endTime: null as number | null,
  };

  for (let i = 0; i < segments.length; i++) {
    const wordObj = segments[i];

    // Handle different word object structures
    let word: string, start: number, end: number;

    if (typeof wordObj === 'string') {
      // If it's just a string, we can't process timing
      throw new Error('Word objects must include timing information');
    } else if (
      wordObj.word &&
      typeof wordObj.start === 'number' &&
      typeof wordObj.end === 'number'
    ) {
      // Standard structure: { word, start, end }
      word = wordObj.word;
      start = wordObj.start;
      end = wordObj.end;
    } else {
      console.error('Unexpected word object structure:', wordObj);
      throw new Error(
        `Invalid word object structure at index ${i}: ${JSON.stringify(
          wordObj
        )}`
      );
    }

    if (currentSegment.startTime === null) {
      currentSegment.startTime = start;
    }

    currentSegment.words += (currentSegment.words ? ' ' : '') + word;
    currentSegment.endTime = end;

    if (isSentenceEnd(word)) {
      if (
        currentSegment.startTime !== null &&
        currentSegment.endTime !== null
      ) {
        const exactDuration = currentSegment.endTime - currentSegment.startTime;

        processedSegments.push({
          id: currentSegment.id,
          words: currentSegment.words.trim(),
          duration: exactDuration,
          startTime: currentSegment.startTime,
          endTime: currentSegment.endTime,
          preEndTime: 0, // Placeholder, will be recalculated after adjustments
          type: 'sentence',
          videoId,
        });
      }

      currentSegment = {
        id: processedSegments.length,
        words: '',
        startTime: null,
        endTime: null,
      };
    }
  }

  // Handle leftover words
  if (
    currentSegment.words &&
    currentSegment.startTime !== null &&
    currentSegment.endTime !== null
  ) {
    const exactDuration = currentSegment.endTime - currentSegment.startTime;

    processedSegments.push({
      id: currentSegment.id,
      words: currentSegment.words.trim(),
      duration: exactDuration,
      startTime: currentSegment.startTime,
      endTime: currentSegment.endTime,
      preEndTime: 0, // Placeholder, will be recalculated after adjustments
      type: 'sentence',
      videoId,
    });
  }

  // Deduplicate overlapping sentences
  const sentenceSegments: SceneSegment[] = [];
  const usedTimeRanges: Array<{ start: number; end: number }> = [];

  for (const segment of processedSegments) {
    // Check if this sentence overlaps significantly with any existing sentence
    let isOverlapping = false;
    for (const used of usedTimeRanges) {
      const overlap =
        Math.min(segment.endTime, used.end) -
        Math.max(segment.startTime, used.start);
      const overlapRatio = overlap / (segment.endTime - segment.startTime);
      if (overlapRatio > 0.5) {
        // More than 50% overlap
        isOverlapping = true;
        break;
      }
    }

    if (!isOverlapping) {
      sentenceSegments.push(segment);
      usedTimeRanges.push({ start: segment.startTime, end: segment.endTime });
    } else {
      console.log(
        `Skipping overlapping sentence: "${segment.words.substring(
          0,
          50
        )}..." (${segment.startTime.toFixed(2)}-${segment.endTime.toFixed(2)})`
      );
    }
  }

  console.log(
    `After deduplication: ${
      sentenceSegments.length
    } unique sentences (removed ${
      processedSegments.length - sentenceSegments.length
    } overlapping duplicates)`
  );

  // Create final segments array including gaps
  const allSegments: SceneSegment[] = [];
  let segmentId = 0;
  const gapSet = new Set(); // Track unique gaps to prevent duplicates
  const sentenceSet = new Set(); // Track unique sentences to prevent duplicates

  // Check if there's silence at the beginning
  if (
    sentenceSegments.length > 0 &&
    sentenceSegments[0].startTime !== null &&
    sentenceSegments[0].startTime > 0
  ) {
    allSegments.push({
      id: segmentId++,
      words: '',
      duration: parseFloat(sentenceSegments[0].startTime.toFixed(2)),
      startTime: 0,
      endTime: parseFloat(sentenceSegments[0].startTime.toFixed(2)),
      preEndTime: 0, // Placeholder, will be recalculated after adjustments
      type: 'gap',
      videoId,
    });
  }

  for (let i = 0; i < sentenceSegments.length; i++) {
    const sentence = sentenceSegments[i];

    // Add the sentence segment (preEndTime will be calculated after adjustments)
    if (sentence.startTime !== null && sentence.endTime !== null) {
      const sentenceKey = `${sentence.startTime.toFixed(
        2
      )}-${sentence.endTime.toFixed(2)}-${sentence.words}`;
      if (!sentenceSet.has(sentenceKey)) {
        sentenceSet.add(sentenceKey);
        allSegments.push({
          id: segmentId++,
          words: sentence.words,
          duration: parseFloat(sentence.duration.toFixed(2)),
          startTime: parseFloat(sentence.startTime.toFixed(2)),
          endTime: parseFloat(sentence.endTime.toFixed(2)),
          preEndTime: 0, // Placeholder, will be recalculated after adjustments
          type: 'sentence',
          videoId,
        });
      }
    }

    // Add gap segment if there's a next sentence
    if (i < sentenceSegments.length - 1) {
      const nextSentence = sentenceSegments[i + 1];
      if (sentence.endTime !== null && nextSentence.startTime !== null) {
        const gapStartTime = sentence.endTime;
        const gapEndTime = nextSentence.startTime;
        const gapDuration = gapEndTime - gapStartTime;

        // Record all gaps (including negative gaps for overlaps)
        const gapKey = `${gapStartTime.toFixed(2)}-${gapEndTime.toFixed(2)}`;
        if (gapDuration !== 0 && !gapSet.has(gapKey)) {
          gapSet.add(gapKey);
          allSegments.push({
            id: segmentId++,
            words: '',
            duration: parseFloat(gapDuration.toFixed(2)),
            startTime: parseFloat(gapStartTime.toFixed(2)),
            endTime: parseFloat(gapEndTime.toFixed(2)),
            preEndTime: 0, // Placeholder, will be recalculated after adjustments
            type: 'gap',
            videoId,
          });
        }
      }
    }
  }

  // Check if there's silence at the end (after the last sentence)
  console.log('Checking for trailing gap...');
  console.log('Video duration:', videoDuration);
  console.log('All segments count:', allSegments.length);

  if (
    videoDuration &&
    typeof videoDuration === 'number' &&
    allSegments.length > 0
  ) {
    // Find the last sentence segment (skip gaps)
    let lastSentenceSegment = null;
    for (let i = allSegments.length - 1; i >= 0; i--) {
      if (allSegments[i].type === 'sentence') {
        lastSentenceSegment = allSegments[i];
        break;
      }
    }

    if (lastSentenceSegment && lastSentenceSegment.endTime < videoDuration) {
      const trailingGapDuration = videoDuration - lastSentenceSegment.endTime;
      if (trailingGapDuration > 0.01) {
        // Only add if gap is meaningful (> 10ms)
        console.log(
          `✅ Adding trailing gap: ${trailingGapDuration.toFixed(
            2
          )}s (video ends at ${videoDuration}s, last word at ${
            lastSentenceSegment.endTime
          }s)`
        );
        allSegments.push({
          id: segmentId++,
          words: '',
          duration: parseFloat(trailingGapDuration.toFixed(2)),
          startTime: parseFloat(lastSentenceSegment.endTime.toFixed(2)),
          endTime: parseFloat(videoDuration.toFixed(2)),
          preEndTime: 0, // Placeholder, will be recalculated after adjustments
          type: 'gap',
          videoId,
        });
      } else {
        console.log(
          `⚠️ Trailing gap too small (${trailingGapDuration.toFixed(
            3
          )}s), not adding`
        );
      }
    } else if (!lastSentenceSegment) {
      console.log('⚠️ No sentence segments found');
    } else {
      console.log(
        `⚠️ No trailing gap (last word at ${lastSentenceSegment.endTime}s, video ends at ${videoDuration}s)`
      );
    }
  } else if (!videoDuration) {
    console.log(
      '⚠️ Video duration not provided - trailing silence cannot be detected'
    );
  } else if (typeof videoDuration !== 'number') {
    console.log(
      `⚠️ Video duration is not a number: ${typeof videoDuration} = ${videoDuration}`
    );
  }

  // Step 3: Adjust timings based on gap durations
  console.log('Adjusting timings based on gap durations...');

  for (let i = 0; i < allSegments.length; i++) {
    const segment = allSegments[i];

    if (segment.type === 'gap') {
      const gapDuration = segment.duration;

      if (gapDuration < 0) {
        // Negative gap means overlap - trim the previous sentence and adjust next sentence
        const overlapDuration = Math.abs(gapDuration);
        console.log(
          `Processing negative gap ${gapDuration.toFixed(2)}s at index ${i}`
        );
        console.log(
          `Previous segment: ${allSegments[i - 1]?.type} ${allSegments[
            i - 1
          ]?.startTime?.toFixed(2)}-${allSegments[i - 1]?.endTime?.toFixed(2)}`
        );
        console.log(
          `Next segment: ${allSegments[i + 1]?.type} ${allSegments[
            i + 1
          ]?.startTime?.toFixed(2)}-${allSegments[i + 1]?.endTime?.toFixed(2)}`
        );

        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          allSegments[i - 1].endTime = parseFloat(
            (allSegments[i - 1].endTime - overlapDuration).toFixed(2)
          );
          allSegments[i - 1].duration = parseFloat(
            (allSegments[i - 1].duration - overlapDuration).toFixed(2)
          );
          console.log(
            `Trimmed previous sentence by ${overlapDuration.toFixed(
              2
            )}s to resolve overlap`
          );
        }

        // Also adjust the next sentence's start time to eliminate overlap
        if (
          i < allSegments.length - 1 &&
          allSegments[i + 1].type === 'sentence'
        ) {
          allSegments[i + 1].startTime = parseFloat(
            (allSegments[i + 1].startTime + overlapDuration).toFixed(2)
          );
          allSegments[i + 1].duration = parseFloat(
            (allSegments[i + 1].duration - overlapDuration).toFixed(2)
          );
          console.log(
            `Adjusted next sentence start time by +${overlapDuration.toFixed(
              2
            )}s to resolve overlap`
          );
        }

        // Remove the negative gap entirely
        segment.startTime = parseFloat(segment.endTime.toFixed(2));
        segment.duration = 0;
      } else if (gapDuration > 0.2) {
        // Gap is larger than 0.2s - adjust adjacent segments by 0.1s
        const adjustAmount = 0.1;

        // Check if there's a sentence before this gap
        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          // Gap is AFTER a sentence - add 0.1s to sentence end time
          allSegments[i - 1].endTime = parseFloat(
            (allSegments[i - 1].endTime + adjustAmount).toFixed(2)
          );
          allSegments[i - 1].duration = parseFloat(
            (allSegments[i - 1].duration + adjustAmount).toFixed(2)
          );
        }

        // Check if there's a sentence after this gap
        if (
          i < allSegments.length - 1 &&
          allSegments[i + 1].type === 'sentence'
        ) {
          // Gap is BEFORE a sentence - subtract 0.1s from sentence start time
          allSegments[i + 1].startTime = parseFloat(
            (allSegments[i + 1].startTime - adjustAmount).toFixed(2)
          );
          allSegments[i + 1].duration = parseFloat(
            (allSegments[i + 1].duration + adjustAmount).toFixed(2)
          );
        }

        // Adjust the gap timing accordingly
        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          // Gap starts later (sentence extended into gap)
          segment.startTime = parseFloat(
            (segment.startTime + adjustAmount).toFixed(2)
          );
          segment.duration = parseFloat(
            (segment.duration - adjustAmount).toFixed(2)
          );
        }
        if (
          i < allSegments.length - 1 &&
          allSegments[i + 1].type === 'sentence'
        ) {
          // Gap ends earlier (sentence extended into gap)
          segment.endTime = parseFloat(
            (segment.endTime - adjustAmount).toFixed(2)
          );
          segment.duration = parseFloat(
            (segment.duration - adjustAmount).toFixed(2)
          );
        }
      } else if (gapDuration > 0) {
        // Gap is smaller than 0.2s - absorb entirely into the previous segment
        // This avoids creating overlaps by not pulling the next segment's start time earlier

        // Extend previous segment (if exists and is a sentence)
        if (i > 0 && allSegments[i - 1].type === 'sentence') {
          allSegments[i - 1].endTime = parseFloat(
            (allSegments[i - 1].endTime + gapDuration).toFixed(2)
          );
          allSegments[i - 1].duration = parseFloat(
            (allSegments[i - 1].duration + gapDuration).toFixed(2)
          );
          console.log(
            `Absorbed ${gapDuration.toFixed(
              2
            )}s gap into previous sentence (extended end time)`
          );
        } else {
          // If no previous sentence, extend the next segment's start time (but don't overlap)
          if (
            i < allSegments.length - 1 &&
            allSegments[i + 1].type === 'sentence'
          ) {
            // Instead of subtracting, just log that we're skipping to avoid overlaps
            console.log(
              `Small gap ${gapDuration.toFixed(
                2
              )}s before sentence - leaving as is to avoid overlap`
            );
          }
        }

        // Remove the gap entirely by setting it to zero duration
        segment.startTime = parseFloat(segment.endTime.toFixed(2));
        segment.duration = 0;
      }
    }
  }

  // Step 4: Remove gaps with zero duration and update IDs
  const filteredSegments = allSegments.filter(
    (segment) => segment.duration > 0
  );
  filteredSegments.forEach((segment, index) => {
    segment.id = index;
  });

  console.log(
    `After gap adjustments: ${filteredSegments.length} segments (removed ${
      allSegments.length - filteredSegments.length
    } zero-duration gaps)`
  );

  // Step 4.5: Final pass to ensure sequential timing (fix any remaining overlaps)
  console.log('Ensuring sequential timing...');
  for (let i = 1; i < filteredSegments.length; i++) {
    const currentSegment = filteredSegments[i];
    const previousSegment = filteredSegments[i - 1];

    if (currentSegment.startTime < previousSegment.endTime) {
      // Overlap detected - adjust current segment's start time
      const overlap = previousSegment.endTime - currentSegment.startTime;
      currentSegment.startTime = previousSegment.endTime;
      currentSegment.endTime = parseFloat(
        (currentSegment.startTime + currentSegment.duration).toFixed(2)
      );
      console.log(
        `Fixed overlap: adjusted segment ${i} start time by +${overlap.toFixed(
          2
        )}s`
      );
    }
  }

  // Step 5: Recalculate preEndTime for all segments based on adjusted timeline
  console.log('Recalculating preEndTime values for adjusted timeline...');
  for (let i = 0; i < filteredSegments.length; i++) {
    if (i === 0) {
      // First segment always starts at 0
      filteredSegments[i].preEndTime = 0;
    } else {
      // Each segment's preEndTime is the previous segment's endTime
      filteredSegments[i].preEndTime = parseFloat(
        filteredSegments[i - 1].endTime.toFixed(2)
      );
    }
  }

  return filteredSegments;
}

// Helper function to get JWT token
async function getJWTToken() {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  const authResponse = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!authResponse.ok) {
    const errorText = await authResponse.text();
    throw new Error(
      `Authentication failed: ${authResponse.status} ${errorText}`
    );
  }

  const authData = await authResponse.json();
  return authData.token;
}

// Function to create multiple scene records in Baserow using batch operation
async function createSceneRecordsBatch(scenes: SceneSegment[]) {
  const baserowUrl = process.env.BASEROW_API_URL;
  const token = await getJWTToken();

  const BATCH_SIZE = 200; // Baserow's maximum batch size
  const allCreatedScenes = [];

  // Process scenes in chunks of 200
  for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
    const chunk = scenes.slice(i, i + BATCH_SIZE);

    console.log(
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
        scenes.length / BATCH_SIZE
      )} (${chunk.length} items)`
    );

    // Prepare batch data for this chunk
    const batchData = {
      items: chunk.map((scene) => ({
        field_6884: scene.duration, // Duration
        field_6889: scene.videoId, // Video ID
        field_6890: scene.words, // Sentence
        field_6896: scene.startTime, // Start Time
        field_6897: scene.endTime, // End Time
        field_6898: scene.preEndTime, // Pre End Time
        field_6901: scene.words, // Original Sentence (same as sentence)
      })),
    };

    // Create scene records in batch
    const response = await fetch(
      `${baserowUrl}/database/rows/table/714/batch/`,
      {
        method: 'POST',
        headers: {
          Authorization: `JWT ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batchData),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create scene records in batch: ${response.status} ${errorText}`
      );
    }

    const result = await response.json();
    const batchItems = result.items || result;
    allCreatedScenes.push(...batchItems);

    console.log(
      `Successfully created ${batchItems.length} scenes in this batch`
    );
  }

  console.log(`Total scenes created: ${allCreatedScenes.length}`);
  return allCreatedScenes;
}

// Function to update original video record with scene IDs
async function updateOriginalVideoWithScenes(
  videoId: string,
  sceneIds: number[]
) {
  const baserowUrl = process.env.BASEROW_API_URL;
  const token = await getJWTToken();

  // Update original video record with scene IDs
  const response = await fetch(
    `${baserowUrl}/database/rows/table/713/${videoId}/`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        field_6866: sceneIds, // Scenes field - linked to table
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to update original video record: ${response.status} ${errorText}`
    );
  }

  return response.json();
}
