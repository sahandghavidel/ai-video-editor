import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://ultimate-video-editor.com',
    'X-Title': 'Ultimate Video Editor',
  },
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { currentSentence, allSentences, sceneId, model } = body;

    if (!currentSentence) {
      return Response.json(
        { error: 'Current sentence is required' },
        { status: 400 }
      );
    }

    if (!allSentences || !Array.isArray(allSentences)) {
      return Response.json(
        { error: 'All sentences array is required' },
        { status: 400 }
      );
    }

    console.log(
      `Improving sentence for scene ${sceneId}: "${currentSentence}"`
    );
    console.log('Making OpenAI API call to OpenRouter...');

    // Create context from all sentences
    const scriptContext = allSentences
      .map((sentence, index) => `${index + 1}. ${sentence}`)
      .join('\n');

    const prompt = `You are an expert script writer improving a video tutorial script. Here is the full script context:

FULL SCRIPT:
${scriptContext}

CURRENT SENTENCE TO IMPROVE: "${currentSentence}"

Please improve this sentence by:
1. Making it more engaging and natural for text-to-speech
2. Ensuring it flows well with the surrounding sentences
3. Maintaining consistency with the tutorial's tone and style
4. Keeping the technical accuracy intact
5. Keeping the improved sentence simple English and easy to understand
6. Avoiding unnecessary jargon and complex vocabulary
7. Ensuring the improved sentence is concise and to the point
8. Never use code snippets like html or css tags
9. The sentences must have at least 5 words
10. Never use single words like "yes", "no", "maybe", "okay", "great", "alright", "now", etc.


Return only the improved sentence, nothing else.`;

    console.log('Prompt length:', prompt.length);

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
