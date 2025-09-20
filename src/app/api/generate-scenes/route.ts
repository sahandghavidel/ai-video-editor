import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { videoId, captionsUrl } = await request.json();

    if (!videoId || !captionsUrl) {
      return NextResponse.json(
        { error: 'Video ID and captions URL are required' },
        { status: 400 }
      );
    }

    console.log('Generating scenes for video:', videoId);
    console.log('Captions URL:', captionsUrl);

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
    const scenes = generateScenesFromTranscription(captionsData, videoId);
    console.log(`Generated ${scenes.length} scenes`);

    // Step 3: Create all scene records in Baserow using batch operation
    console.log(`Creating ${scenes.length} scenes in batch...`);
    const createdScenes = await createSceneRecordsBatch(scenes);
    const sceneIds = createdScenes.map((scene: any) => scene.id);

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
  transcriptionData: any,
  videoId: string
) {
  // Handle different data structures
  let segments: any[] = [];

  if (Array.isArray(transcriptionData)) {
    // Direct array of word objects
    segments = transcriptionData;
  } else if (transcriptionData.Segments) {
    segments = transcriptionData.Segments;
  } else if (transcriptionData.segments) {
    segments = transcriptionData.segments;
  } else if (transcriptionData.words) {
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

  const sentenceSegments = [];
  let currentSegment = {
    id: 0,
    words: '',
    startTime: null as number | null,
    endTime: null as number | null,
  };

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

        sentenceSegments.push({
          id: currentSegment.id,
          words: currentSegment.words.trim(),
          duration: exactDuration,
          startTime: currentSegment.startTime,
          endTime: currentSegment.endTime,
          type: 'sentence',
        });
      }

      currentSegment = {
        id: sentenceSegments.length,
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

    sentenceSegments.push({
      id: currentSegment.id,
      words: currentSegment.words.trim(),
      duration: exactDuration,
      startTime: currentSegment.startTime,
      endTime: currentSegment.endTime,
      type: 'sentence',
    });
  }

  // Create final segments array including gaps
  const allSegments = [];
  let segmentId = 0;

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
      preEndTime: 0.0,
      type: 'gap',
      videoId,
    });
  }

  for (let i = 0; i < sentenceSegments.length; i++) {
    const sentence = sentenceSegments[i];

    // Calculate previous end time
    let preEndTime = 0;
    if (allSegments.length > 0) {
      preEndTime = allSegments[allSegments.length - 1].endTime;
    }

    // Add the sentence segment
    if (sentence.startTime !== null && sentence.endTime !== null) {
      allSegments.push({
        id: segmentId++,
        words: sentence.words,
        duration: parseFloat(sentence.duration.toFixed(2)),
        startTime: parseFloat(sentence.startTime.toFixed(2)),
        endTime: parseFloat(sentence.endTime.toFixed(2)),
        preEndTime: parseFloat(preEndTime.toFixed(2)),
        type: 'sentence',
        videoId,
      });
    }

    // Add gap segment if there's a next sentence
    if (i < sentenceSegments.length - 1) {
      const nextSentence = sentenceSegments[i + 1];
      if (sentence.endTime !== null && nextSentence.startTime !== null) {
        const gapStartTime = sentence.endTime;
        const gapEndTime = nextSentence.startTime;
        const gapDuration = gapEndTime - gapStartTime;

        // Record all gaps (no threshold check as requested)
        if (gapDuration > 0) {
          allSegments.push({
            id: segmentId++,
            words: '',
            duration: parseFloat(gapDuration.toFixed(2)),
            startTime: parseFloat(gapStartTime.toFixed(2)),
            endTime: parseFloat(gapEndTime.toFixed(2)),
            preEndTime: parseFloat(sentence.endTime.toFixed(2)),
            type: 'gap',
            videoId,
          });
        }
      }
    }
  }

  return allSegments;
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
async function createSceneRecordsBatch(scenes: any[]) {
  const baserowUrl = process.env.BASEROW_API_URL;
  const token = await getJWTToken();

  // Prepare batch data
  const batchData = {
    items: scenes.map((scene) => ({
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
  const response = await fetch(`${baserowUrl}/database/rows/table/714/batch/`, {
    method: 'POST',
    headers: {
      Authorization: `JWT ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(batchData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create scene records in batch: ${response.status} ${errorText}`
    );
  }

  const result = await response.json();
  return result.items || result; // Baserow batch response format
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
