#!/bin/bash

curl -s -X POST http://localhost:9540/api/test-silence-detection \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"http://host.docker.internal:9000/nca-toolkit/video_1762417429267.mp4","soundLevel":-43,"minSilenceLength":0.3}' | \
  jq -r '.intervals[] | select(.rawEnd <= 30) | "\(.rawStart) \(.rawEnd)"' | \
  awk 'BEGIN {
    print "================================================================================"
    print "VOICE vs SILENCE TIMELINE - FIRST 30 SECONDS"
    print "================================================================================"
    print ""
    last_end = 0
}
{
    start = $1
    end = $2
    
    # Voice before silence
    if (start > last_end) {
        voice_dur = start - last_end
        printf "[%.3fs - %.3fs] VOICE    (duration: %.3fs)\n", last_end, start, voice_dur
    }
    
    # Silence
    silence_dur = end - start
    printf "[%.3fs - %.3fs] SILENCE  (duration: %.3fs)\n", start, end, silence_dur
    
    last_end = end
}
END {
    if (last_end < 30) {
        printf "[%.3fs - 30.000s] VOICE    (duration: %.3fs)\n", last_end, 30 - last_end
    }
    print ""
    print "================================================================================"
    print "Check these timestamps in your video to verify detection accuracy"
    print "================================================================================"
}'
