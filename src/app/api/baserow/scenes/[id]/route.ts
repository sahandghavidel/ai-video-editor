import { NextRequest, NextResponse } from 'next/server';

// Helper function to get JWT token for Baserow API
async function getJWTToken(): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error('Missing Baserow configuration');
  }

  const response = await fetch(`${baserowUrl}/user/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Authentication failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.token;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sceneId = parseInt(id);
    if (isNaN(sceneId)) {
      return NextResponse.json({ error: 'Invalid scene ID' }, { status: 400 });
    }

    const body = await request.json();
    const baserowUrl = process.env.BASEROW_API_URL;
    const scenesTableId = '714'; // Scenes table

    if (!baserowUrl) {
      return NextResponse.json({ error: 'Missing Baserow URL' }, { status: 500 });
    }

    // Get JWT token
    const token = await getJWTToken();

    // Update the scene in Baserow
    const response = await fetch(
      `${baserowUrl}/database/rows/table/${scenesTableId}/${sceneId}/`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `JWT ${token}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to update scene:', errorText);
      return NextResponse.json(
        { error: `Failed to update scene: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating scene:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}