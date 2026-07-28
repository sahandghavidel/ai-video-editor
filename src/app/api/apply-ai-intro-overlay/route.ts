export const runtime = 'nodejs';

export async function POST() {
  return Response.json(
    {
      error:
        'The separate AI overlay queue was removed. Build the original-video clip in Choose Video Sections and use the normal overlay Apply action.',
    },
    { status: 410 },
  );
}
