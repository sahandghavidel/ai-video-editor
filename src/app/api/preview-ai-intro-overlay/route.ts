export const runtime = 'nodejs';

export async function POST() {
  return Response.json(
    {
      error:
        'The separate AI queue preview was removed. Build the original-video clip in Choose Video Sections and use the normal overlay Preview action.',
    },
    { status: 410 },
  );
}
