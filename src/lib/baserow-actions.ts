'use server';

export interface BaserowRow {
  id: number;
  [key: string]: unknown;
}

// Cache the JWT token for the duration of the server action
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getJWTToken(forceRefresh = false): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  // Return cached token if it's still valid (with 5 minute buffer) and not forcing refresh
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  // Clear cached token when refreshing
  cachedToken = null;
  tokenExpiry = 0;

  try {
    console.log('Fetching new JWT token from Baserow...');
    const response = await fetch(`${baserowUrl}/user/token-auth/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Auth failed with response:', errorText);
      throw new Error(
        `Authentication failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    cachedToken = data.token;
    // JWT tokens typically expire in 1 hour, cache for 50 minutes to be safe
    tokenExpiry = Date.now() + 50 * 60 * 1000;

    if (!cachedToken) {
      throw new Error('No token received from Baserow');
    }

    console.log('Successfully obtained new JWT token');
    return cachedToken;
  } catch (error) {
    console.error('Error authenticating with Baserow:', error);
    throw error;
  }
}

// Helper function to make API requests with automatic token refresh
async function makeAuthenticatedRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  async function requestWithToken(token: string): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      throw new Error('TOKEN_EXPIRED');
    }

    return response;
  }

  try {
    // First attempt with cached token
    const token = await getJWTToken();
    return await requestWithToken(token);
  } catch (error) {
    // If token expired, try once more with fresh token
    if (error instanceof Error && error.message === 'TOKEN_EXPIRED') {
      console.log('Token expired, refreshing and retrying request...');
      const freshToken = await getJWTToken(true); // Force refresh
      return await requestWithToken(freshToken);
    }

    throw error;
  }
}

export async function getBaserowData(): Promise<BaserowRow[]> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    // Set a high page size to get more rows (Baserow allows up to 200 per request)
    const pageSize = 200;
    let allRows: BaserowRow[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${baserowUrl}/database/rows/table/${tableId}/?size=${pageSize}&page=${page}`;

      const response = await makeAuthenticatedRequest(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Data fetch failed with response:', errorText);
        throw new Error(
          `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const results = data.results || [];

      allRows = allRows.concat(results);

      // Check if there are more pages
      hasMore = data.next !== null;
      page++;

      console.log(
        `Fetched page ${page - 1}: ${results.length} rows, Total so far: ${
          allRows.length
        }`
      );
    }

    console.log(`Total rows fetched from Baserow: ${allRows.length}`);
    return allRows;
  } catch (error) {
    console.error('Error fetching Baserow data:', error);
    throw error;
  }
}

export async function getOriginalVideosData(): Promise<BaserowRow[]> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Original videos table ID

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    // Set a high page size to get more rows (Baserow allows up to 200 per request)
    const pageSize = 200;
    let allRows: BaserowRow[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${baserowUrl}/database/rows/table/${originalVideosTableId}/?size=${pageSize}&page=${page}`;

      const response = await makeAuthenticatedRequest(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          'Original videos data fetch failed with response:',
          errorText
        );
        throw new Error(
          `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const results = data.results || [];

      allRows = allRows.concat(results);

      // Check if there are more pages
      hasMore = data.next !== null;
      page++;

      console.log(
        `Fetched original videos page ${page - 1}: ${
          results.length
        } rows, Total so far: ${allRows.length}`
      );
    }

    console.log(
      `Total original videos fetched from Baserow: ${allRows.length}`
    );
    return allRows;
  } catch (error) {
    console.error('Error fetching original videos data:', error);
    throw error;
  }
}

export async function createBaserowRow(
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${tableId}/`,
      {
        method: 'POST',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating Baserow row:', error);
    throw error;
  }
}

export async function updateBaserowRow(
  rowId: number,
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
      {
        method: 'PATCH',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating Baserow row:', error);
    throw error;
  }
}

export async function deleteBaserowRow(rowId: number): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
      {
        method: 'DELETE',
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
  } catch (error) {
    console.error('Error deleting Baserow row:', error);
    throw error;
  }
}

export async function deleteOriginalVideoRow(rowId: number): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Table 713 for original videos

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${originalVideosTableId}/${rowId}/`,
      {
        method: 'DELETE',
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
  } catch (error) {
    console.error('Error deleting original video row:', error);
    throw error;
  }
}

export async function deleteRelatedScenes(
  originalVideoId: number
): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const scenesTableId = process.env.BASEROW_TABLE_ID; // Table 714 for scenes

  if (!baserowUrl || !scenesTableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    // First, get all scenes that belong to this original video
    const scenesData = await getBaserowData();
    const relatedScenes = scenesData.filter((scene) => {
      const videoId = scene.field_6889;
      if (typeof videoId === 'number') {
        return videoId === originalVideoId;
      }
      if (typeof videoId === 'string') {
        return parseInt(videoId, 10) === originalVideoId;
      }
      return false;
    });

    // Delete each related scene
    const deletePromises = relatedScenes.map((scene) =>
      makeAuthenticatedRequest(
        `${baserowUrl}/database/rows/table/${scenesTableId}/${scene.id}/`,
        {
          method: 'DELETE',
          cache: 'no-store',
        }
      )
    );

    await Promise.all(deletePromises);
    console.log(
      `Deleted ${relatedScenes.length} related scenes for video ${originalVideoId}`
    );
  } catch (error) {
    console.error('Error deleting related scenes:', error);
    throw error;
  }
}

export async function deleteOriginalVideoWithScenes(
  originalVideoId: number
): Promise<void> {
  try {
    // First delete all related scenes
    await deleteRelatedScenes(originalVideoId);

    // Then delete the original video
    await deleteOriginalVideoRow(originalVideoId);

    console.log(
      `Successfully deleted original video ${originalVideoId} and all related scenes`
    );
  } catch (error) {
    console.error('Error deleting original video with scenes:', error);
    throw error;
  }
}

export async function createOriginalVideoRow(
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Table 713 for original videos

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${originalVideosTableId}/`,
      {
        method: 'POST',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating original video row:', error);
    throw error;
  }
}

export async function updateOriginalVideoRow(
  rowId: number,
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const originalVideosTableId = '713'; // Table 713 for original videos

  if (!baserowUrl) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const response = await makeAuthenticatedRequest(
      `${baserowUrl}/database/rows/table/${originalVideosTableId}/${rowId}/`,
      {
        method: 'PATCH',
        body: JSON.stringify(rowData),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating original video row:', error);
    throw error;
  }
}
