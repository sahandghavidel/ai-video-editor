import OpenAI from 'openai';
import { getBaserowData } from '@/lib/baserow-actions';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://ultimate-video-editor.com',
    'X-Title': 'Ultimate Video Editor',
  },
});

// Helper function to fetch scenes from Baserow table 714
async function getScenesFromTable(): Promise<any[]> {
  try {
    // Use the existing getBaserowData function which handles authentication and pagination
    const scenes = await getBaserowData();
    console.log(`Fetched ${scenes.length} scenes from Baserow`);
    return scenes;
  } catch (error) {
    console.error('Error fetching scenes from Baserow:', error);
    return [];
  }
}

// 11. instead single words at the begginning of the sentence like so, next, then, after that, finally, etc. use alternatives with at least 3 words like "in the next step", 'moving on to the next part', 'after completing this section', 'to wrap things up', etc.

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { currentSentence, sceneId, model } = body;

    if (!currentSentence) {
      return Response.json(
        { error: 'Current sentence is required' },
        { status: 400 }
      );
    }

    if (!sceneId) {
      return Response.json({ error: 'Scene ID is required' }, { status: 400 });
    }

    console.log(
      `Improving sentence for scene ${sceneId}: "${currentSentence}"`
    );
    console.log('Making OpenAI API call to OpenRouter...');

    // Fetch all scenes from table 714
    const allScenes = await getScenesFromTable();
    console.log(`Fetched ${allScenes.length} scenes from table 714`);

    // Find the current scene to get its video ID
    const currentScene = allScenes.find((scene) => scene.id === sceneId);
    if (!currentScene) {
      console.log(`Scene ${sceneId} not found in table 714`);
      // Fall back to independent operation
    }

    const videoId = currentScene?.field_6889;
    console.log(`Video ID for scene ${sceneId}: ${videoId}`);

    // Filter scenes by video ID and extract sentences
    let allSentences: string[] = [];
    let sentenceNumber = 1;
    let videoScenes: any[] = [];

    if (videoId && allScenes.length > 0) {
      videoScenes = allScenes.filter((scene) => {
        const sceneVideoId = scene.field_6889;
        return String(sceneVideoId) === String(videoId);
      });

      console.log(`Found ${videoScenes.length} scenes for video ${videoId}`);

      allSentences = videoScenes
        .map((scene) => String(scene.field_6901 || scene.field_6891 || ''))
        .filter((sentence) => sentence.trim())
        .sort((a, b) => {
          // Try to sort by some ordering field if available
          const sceneA = videoScenes.find(
            (s) => String(s.field_6901 || s.field_6891) === a
          );
          const sceneB = videoScenes.find(
            (s) => String(s.field_6901 || s.field_6891) === b
          );
          return (sceneA?.id || 0) - (sceneB?.id || 0);
        });

      // Find the current sentence's position
      const currentSentenceIndex = allSentences.findIndex(
        (sentence) => sentence.trim() === currentSentence.trim()
      );
      sentenceNumber = currentSentenceIndex + 1;

      console.log(
        `Extracted ${allSentences.length} sentences, current is #${sentenceNumber}`
      );
    }

    // Create context from all sentences if available
    let scriptContext = '';
    let hasContext = allSentences.length > 1; // Need at least 2 sentences for meaningful context

    if (hasContext) {
      // Create scene-sentence mapping for context
      const sceneSentenceMap = videoScenes
        .filter((scene) => {
          const sentence = String(
            scene.field_6901 || scene.field_6891 || ''
          ).trim();
          return sentence && allSentences.includes(sentence);
        })
        .map((scene) => ({
          sceneId: scene.id,
          sentence: String(scene.field_6901 || scene.field_6891 || '').trim(),
        }))
        .sort((a, b) => a.sceneId - b.sceneId);

      scriptContext = sceneSentenceMap
        .map((item) => `Scene ${item.sceneId}: ${item.sentence}`)
        .join('\n');
      console.log(
        `Using script context: YES (${sceneSentenceMap.length} sentences)`
      );
    } else {
      console.log('Insufficient context - operating independently');
    }

    const prompt = `This is a standalone, independent request. Do not reference or remember any previous conversations, requests, or context from other calls.

Request ID: ${Date.now()}-${Math.random().toString(36).substr(2, 9)}

You are an expert script writer improving a single sentence from a video tutorial script.${
      hasContext
        ? ` Here is the full script context for reference:

FULL SCRIPT:
${scriptContext}

CURRENT SENTENCE TO IMPROVE (Scene #${sceneId}): ${currentSentence}

Please improve this sentence by following these guidelines:
• Make it more engaging and natural for text-to-speech
• Keep the technical accuracy intact
• Use simple English that's easy to understand
• Avoid unnecessary jargon and complex vocabulary
• Ensure the improved sentence must be longer than the original with more detail and clarity.
• if your improvement includes a sentence
more than 10 words), make it into smaller sentences (a sentence ends with a period), but keep the meaning and length similar.
• Never use code snippets like html or css tags
• The sentences must have at least 5 words
• Never use single words like "yes", "no", "maybe", "okay", "great", "alright", "now", "so", "then", "finally", etc.
• Instead of single words at the beginning of sentences like "so", use alternatives with at least 3 words.`
        : `

SENTENCE TO IMPROVE: ${currentSentence}

Please improve this sentence by following these guidelines:
• Make it more engaging and natural for text-to-speech
• Keep the technical accuracy intact
• Use simple English that's easy to understand
• Avoid unnecessary jargon and complex vocabulary
• Ensure the improved sentence must be longer than the original with more detail and clarity.
• if your improvement includes a sentence
more than 10 words), make it into smaller sentences (a sentence ends with a period), but keep the meaning and length similar.
• Never use code snippets like html or css tags
• The sentences must have at least 5 words
• Never use single words like "yes", "no", "maybe", "okay", "great", "alright", "now", "so", "then", "finally", etc.
• Instead of single words at the beginning of sentences like "so", use alternatives with at least 3 words.`
    }

Return only the improved sentence, nothing else.`;

    console.log('Prompt length:', prompt);

    // Use the original DeepSeek model that was working
    const completion = await openai.chat.completions.create({
      model:
        model ||
        'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    console.log(
      'OpenAI completion response:',
      JSON.stringify(completion, null, 2)
    );

    // Check the standard OpenAI response structure
    let improvedSentence;

    if (completion.choices && completion.choices[0]) {
      const choice = completion.choices[0];
      console.log('First choice:', JSON.stringify(choice, null, 2));

      // For DeepSeek R1, try content first, then reasoning field
      const message = choice.message;
      if (message) {
        // First try the standard content field
        improvedSentence = message.content?.trim();

        // If content is empty, check the reasoning field (DeepSeek R1 specific)
        if (!improvedSentence) {
          const extendedMessage = message as any;
          if (extendedMessage.reasoning) {
            console.log('Content empty, extracting from reasoning field...');
            const reasoning: string = extendedMessage.reasoning;

            // Split reasoning into sentences and look for the improved version
            const sentences = reasoning
              .split(/[.!?]+/)
              .map((s: string) => s.trim())
              .filter((s: string) => s.length > 10);

            // Look for sentences that seem to be improvements of the original
            // Skip obvious reasoning/explanation patterns
            for (const sentence of sentences) {
              // Skip meta-commentary about the task
              if (
                sentence.includes('TTS-friendly') ||
                sentence.includes('flows well') ||
                sentence.includes('common words') ||
                sentence.includes('complex structures') ||
                sentence.includes('Avoid') ||
                sentence.includes('ensure it') ||
                sentence.includes('Original:') ||
                sentence.includes('Improved:') ||
                sentence.includes('reasoning') ||
                (sentence.toLowerCase().includes('css') === false &&
                  sentence.toLowerCase().includes('html') === false &&
                  sentence.toLowerCase().includes('project') === false)
              ) {
                continue;
              }

              // Look for sentences that contain key words from the original and seem like improvements
              if (
                (sentence.includes('section') ||
                  sentence.includes('styling') ||
                  sentence.includes('CSS') ||
                  sentence.includes('project')) &&
                sentence.length > 20 &&
                sentence.length < 200 &&
                !sentence.includes('2.') &&
                !sentence.includes('1.') &&
                !sentence.startsWith('So ') &&
                !sentence.startsWith('Therefore ')
              ) {
                improvedSentence = sentence.trim();
                // Add proper punctuation if missing
                if (
                  !improvedSentence.endsWith('.') &&
                  !improvedSentence.endsWith('!') &&
                  !improvedSentence.endsWith('?')
                ) {
                  improvedSentence += '.';
                }
                console.log('Extracted improved sentence:', improvedSentence);
                break;
              }
            }

            // If still no good match found, try a different approach - look for complete sentences
            if (!improvedSentence) {
              const lines = reasoning
                .split('\n')
                .map((line: string) => line.trim())
                .filter((line: string) => line);

              for (const line of lines) {
                // Look for lines that seem to be complete sentences about the project/CSS
                if (
                  line.includes('CSS') ||
                  line.includes('styling') ||
                  line.includes('section')
                ) {
                  if (
                    line.length > 20 &&
                    line.length < 150 &&
                    (line.endsWith('.') || line.endsWith('!')) &&
                    !line.includes('TTS-friendly') &&
                    !line.includes('flows well') &&
                    !line.includes('2.') &&
                    !line.includes('1.')
                  ) {
                    improvedSentence = line;
                    console.log(
                      'Extracted from line-based search:',
                      improvedSentence
                    );
                    break;
                  }
                }
              }
            }
          }
        }

        // Remove quotes if they exist
        if (
          improvedSentence &&
          improvedSentence.startsWith('"') &&
          improvedSentence.endsWith('"')
        ) {
          improvedSentence = improvedSentence.slice(1, -1);
        }
      }
    }

    // If still no content, try fallback improvement
    if (!improvedSentence) {
      console.log('No content from LLM, using fallback improvement');
      // Use simple rule-based improvement as fallback
      improvedSentence = currentSentence
        .replace(/^(Alright|Ok|Okay),?\s*/i, 'Great! ')
        .replace(/\bwe have\b/g, "we've")
        .replace(/\bfinished with\b/g, 'completed')
        .replace(/\bgoing to\b/g, 'going to')
        .replace(/\. /g, '. ');

      console.log('Using fallback improved sentence:', improvedSentence);
    }

    console.log(`Original: "${currentSentence}"`);
    console.log(`Improved: "${improvedSentence}"`);

    return Response.json({
      originalSentence: currentSentence,
      improvedSentence,
      sceneId,
    });
  } catch (error) {
    console.error('Error improving sentence:', error);

    let errorMessage = 'Failed to improve sentence';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
