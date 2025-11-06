import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const {
      videoUrl,
      soundLevel = -43,
      minSilenceLength = 0.3,
      minSilenceDurationToSpeedUp = 0.3, // Only speed up silences >= this duration (after padding)
    } = await request.json();

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL is required' },
        { status: 400 }
      );
    }

    console.log(`[TEST] Detecting silence in: ${videoUrl}`);
    console.log(
      `[TEST] Parameters: soundLevel=${soundLevel}dB, minSilenceLength=${minSilenceLength}s`
    );
    console.log(
      `[TEST] Minimum silence duration to speed up (after padding): ${minSilenceDurationToSpeedUp}s`
    );

    // Step 1: Detect silence using FFmpeg silencedetect filter
    const detectCommand = [
      'ffmpeg',
      '-i',
      `"${videoUrl}"`,
      '-af',
      `silencedetect=noise=${soundLevel}dB:d=${minSilenceLength}`,
      '-f',
      'null',
      '-',
    ];

    const detectCommandString = detectCommand.join(' ');
    console.log(`[TEST] Running: ${detectCommandString}`);

    const { stderr: detectStderr } = await execAsync(detectCommandString, {
      timeout: 300000,
    });

    // Parse silence intervals from stderr
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];

    const silenceStartRegex = /silence_start: ([\d.]+)/g;
    const silenceEndRegex = /silence_end: ([\d.]+)/g;

    let match;
    while ((match = silenceStartRegex.exec(detectStderr)) !== null) {
      silenceStarts.push(parseFloat(match[1]));
    }
    while ((match = silenceEndRegex.exec(detectStderr)) !== null) {
      silenceEnds.push(parseFloat(match[1]));
    }

    console.log(`[TEST] Found ${silenceStarts.length} silence intervals`);

    // Padding settings - padding is added to VOICE (speech) to preserve it,
    // which makes the silence interval SMALLER
    const leftPadding = 0.14; // seconds - preserve this much speech BEFORE silence
    const rightPadding = 0.26; // seconds - preserve this much speech AFTER silence

    // Filter: Only speed up silences >= minSilenceDurationToSpeedUp (after padding)

    // Create intervals array with padding and filtering
    const intervals = [];
    let ignoredCount = 0;

    for (
      let i = 0;
      i < Math.min(silenceStarts.length, silenceEnds.length);
      i++
    ) {
      const rawStart = silenceStarts[i];
      const rawEnd = silenceEnds[i];
      const rawDuration = rawEnd - rawStart;

      // Apply padding: shrink the silence interval to preserve voice around it
      // Left padding: start silence LATER (skip first part to keep voice)
      // Right padding: end silence EARLIER (skip last part to keep voice)
      const paddedStart = rawStart + leftPadding;
      const paddedEnd = rawEnd - rightPadding;
      const paddedDuration = paddedEnd - paddedStart;

      // Only process if there's still silence left after padding
      if (paddedDuration <= 0) {
        ignoredCount++;
        console.log(
          `[TEST] Ignoring - no silence left after padding: ${rawStart.toFixed(
            3
          )}s - ${rawEnd.toFixed(3)}s (padded: ${paddedDuration.toFixed(3)}s)`
        );
        continue;
      }

      // Check: Ignore silences shorter than threshold (based on PADDED duration)
      if (paddedDuration < minSilenceDurationToSpeedUp) {
        ignoredCount++;
        console.log(
          `[TEST] Ignoring short silence: raw ${rawStart.toFixed(
            3
          )}s - ${rawEnd.toFixed(3)}s | padded: ${paddedDuration.toFixed(
            3
          )}s < ${minSilenceDurationToSpeedUp}s`
        );
        continue;
      }

      // This interval passes all filters - it will be sped up 4x
      intervals.push({
        rawStart: rawStart,
        rawEnd: rawEnd,
        rawDuration: rawDuration,
        start: paddedStart,
        end: paddedEnd,
        duration: paddedDuration,
      });
    }

    console.log(
      `[TEST] Result: ${intervals.length} intervals will be sped up 4x, ${ignoredCount} intervals ignored (too short or no silence after padding)`
    );

    // Log first 20 intervals
    console.log(
      '[TEST] First 20 intervals to be SPED UP 4x (passed all filters):'
    );
    for (let i = 0; i < Math.min(20, intervals.length); i++) {
      console.log(
        `  [${i}] ⏩ SPEED 4x | raw: ${intervals[i].rawStart.toFixed(
          3
        )}s - ${intervals[i].rawEnd.toFixed(3)}s | padded: ${intervals[
          i
        ].start.toFixed(3)}s - ${intervals[i].end.toFixed(
          3
        )}s (duration: ${intervals[i].duration.toFixed(3)}s)`
      );
    }

    // Log VOICE vs SILENCE timeline for first 3 minutes
    console.log('\n' + '='.repeat(80));
    console.log('VOICE vs SILENCE TIMELINE - FIRST 3 MINUTES (180 SECONDS)');
    console.log('='.repeat(80));
    let lastEnd = 0;
    for (let i = 0; i < intervals.length; i++) {
      if (intervals[i].rawEnd > 180) break;

      // Voice before this silence
      if (intervals[i].rawStart > lastEnd) {
        const voiceDuration = intervals[i].rawStart - lastEnd;
        console.log(
          `[${lastEnd.toFixed(3)}s - ${intervals[i].rawStart.toFixed(
            3
          )}s] 🎤 VOICE    (duration: ${voiceDuration.toFixed(3)}s)`
        );
      }

      // Silence - all intervals in this list will be sped up 4x
      const silenceDuration = intervals[i].rawEnd - intervals[i].rawStart;
      console.log(
        `[${intervals[i].rawStart.toFixed(3)}s - ${intervals[i].rawEnd.toFixed(
          3
        )}s] 🔇 SILENCE  (⏩ SPEED 4x, duration: ${silenceDuration.toFixed(
          3
        )}s)`
      );

      lastEnd = intervals[i].rawEnd;
    }

    // Last voice segment
    if (lastEnd < 180) {
      console.log(
        `[${lastEnd.toFixed(3)}s - 180.000s] 🎤 VOICE    (duration: ${(
          180 - lastEnd
        ).toFixed(3)}s)`
      );
    }
    console.log('='.repeat(80));
    console.log(
      'Check these timestamps in your video to verify detection accuracy\n'
    );

    return NextResponse.json({
      success: true,
      totalIntervals: intervals.length,
      intervals: intervals,
    });
  } catch (error) {
    console.error('[TEST] Error:', error);
    return NextResponse.json(
      {
        error: 'Detection failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
