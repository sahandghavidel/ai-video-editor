import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text, sceneId, ttsSettings } = await request.json();

    if (!text || !sceneId) {
      return NextResponse.json(
        { error: 'Text and sceneId are required' },
        { status: 400 }
      );
    }

    // Use dynamic TTS settings or defaults
    const settings = ttsSettings || {
      temperature: 0.1,
      exaggeration: 0.5,
      cfg_weight: 0.2,
      seed: 1212,
      reference_audio_filename: 'audio3_enhanced.wav',
    };

    // Step 1: Generate TTS
    const ttsPayload = {
      text: text,
      temperature: settings.temperature,
      exaggeration: settings.exaggeration,
      cfg_weight: settings.cfg_weight,
      speed_factor: 1,
      seed: settings.seed,
      language: 'en',
      voice_mode: 'clone',
      split_text: true,
      chunk_size: 50,
      output_format: 'wav',
      reference_audio_filename: settings.reference_audio_filename,
    };

    const ttsResponse = await fetch('http://host.docker.internal:8004/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ttsPayload),
    });

    if (!ttsResponse.ok) {
      throw new Error(`TTS service error: ${ttsResponse.status}`);
    }

    // Get the audio file as buffer
    const audioBuffer = await ttsResponse.arrayBuffer();

    // Step 2: Upload to MinIO
    const timestamp = Date.now();
    const filename = `tts_${sceneId}_${timestamp}.wav`;
    const bucket = 'nca-toolkit';
    const uploadUrl = `http://host.docker.internal:9000/${bucket}/${filename}`;

    // Upload to MinIO
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/wav',
      },
      body: audioBuffer,
    });

    if (!uploadResponse.ok) {
      throw new Error(`MinIO upload error: ${uploadResponse.status}`);
    }

    return NextResponse.json({
      audioUrl: uploadUrl,
      filename,
      bucket,
      sceneId,
    });
  } catch (error) {
    console.error('Error generating TTS:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
