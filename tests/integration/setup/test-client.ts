/**
 * Test HTTP client that uses the real Hono app directly
 */

// Ensure Sites extension is enabled before importing the app
// Sites extension auto-detects based on S3 or executor being configured
process.env.SITES_S3_ENDPOINT = process.env.SITES_S3_ENDPOINT || "http://localhost:9000";
process.env.SITES_S3_BUCKET = process.env.SITES_S3_BUCKET || "test-bucket";
process.env.SITES_S3_ACCESS_KEY = process.env.SITES_S3_ACCESS_KEY || "test-access-key";
process.env.SITES_S3_SECRET_KEY = process.env.SITES_S3_SECRET_KEY || "test-secret-key";

// Ensure Pomerium extension is enabled for testing
// Pomerium extension auto-detects based on POMERIUM_INTERNAL_URL
process.env.POMERIUM_INTERNAL_URL = process.env.POMERIUM_INTERNAL_URL || "http://localhost:5080";

export interface TestResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

const BASE_URL = "http://localhost:3001";

// Lazy import the app to ensure env is set first
let _app: Awaited<typeof import("../../../apps/api/src/index")>["default"] | null = null;
let _waitForRoutes: (() => Promise<void>) | null = null;
let _appReady = false;

async function getApp() {
  if (!_app) {
    const module = await import("../../../apps/api/src/index");
    _app = module.default;
    _waitForRoutes = module.waitForRoutes;
  }

  // Wait for async routes to be loaded (Sites extension routes are loaded async)
  // Use the exported waitForRoutes function instead of a fixed delay
  if (!_appReady) {
    if (_waitForRoutes) {
      await _waitForRoutes();
    }
    // Small additional delay to ensure routes are fully mounted
    await new Promise(resolve => setTimeout(resolve, 100));
    _appReady = true;
  }

  return _app;
}

export class TestClient {
  async get<T = unknown>(
    path: string,
    headers?: Record<string, string>
  ): Promise<TestResponse<T>> {
    const app = await getApp();
    const req = new Request(`${BASE_URL}${path}`, {
      method: "GET",
      headers: headers || {},
    });
    const response = await app.fetch(req);
    let body: T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      body = (await response.json()) as T;
    } else {
      body = (await response.text()) as unknown as T;
    }
    return {
      status: response.status,
      body,
      headers: response.headers,
    };
  }

  /**
   * Get raw Response object without parsing body
   * Useful for testing binary responses like images
   */
  async getRaw(
    path: string,
    headers?: Record<string, string>
  ): Promise<Response> {
    const app = await getApp();
    const req = new Request(`${BASE_URL}${path}`, {
      method: "GET",
      headers: headers || {},
    });
    return app.fetch(req);
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<TestResponse<T>> {
    const app = await getApp();
    const req = new Request(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const response = await app.fetch(req);
    let responseBody: T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      responseBody = (await response.json()) as T;
    } else {
      responseBody = (await response.text()) as unknown as T;
    }
    return {
      status: response.status,
      body: responseBody,
      headers: response.headers,
    };
  }

  async put<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<TestResponse<T>> {
    const app = await getApp();
    const req = new Request(`${BASE_URL}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const response = await app.fetch(req);
    let responseBody: T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      responseBody = (await response.json()) as T;
    } else {
      responseBody = (await response.text()) as unknown as T;
    }
    return {
      status: response.status,
      body: responseBody,
      headers: response.headers,
    };
  }

  async patch<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<TestResponse<T>> {
    const app = await getApp();
    const req = new Request(`${BASE_URL}${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const response = await app.fetch(req);
    let responseBody: T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      responseBody = (await response.json()) as T;
    } else {
      responseBody = (await response.text()) as unknown as T;
    }
    return {
      status: response.status,
      body: responseBody,
      headers: response.headers,
    };
  }

  async delete<T = unknown>(
    path: string,
    headers?: Record<string, string>
  ): Promise<TestResponse<T>> {
    const app = await getApp();
    const req = new Request(`${BASE_URL}${path}`, {
      method: "DELETE",
      headers: headers || {},
    });
    const response = await app.fetch(req);
    let body: T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      body = (await response.json()) as T;
    } else {
      body = (await response.text()) as unknown as T;
    }
    return {
      status: response.status,
      body,
      headers: response.headers,
    };
  }

  async uploadFile<T = unknown>(
    path: string,
    file: File,
    fieldName = "file"
  ): Promise<TestResponse<T>> {
    const app = await getApp();
    const formData = new FormData();
    formData.append(fieldName, file);

    const req = new Request(`${BASE_URL}${path}`, {
      method: "POST",
      body: formData,
    });
    const response = await app.fetch(req);
    let body: T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      body = (await response.json()) as T;
    } else {
      body = (await response.text()) as unknown as T;
    }
    return {
      status: response.status,
      body,
      headers: response.headers,
    };
  }

  /**
   * Post form data (multipart/form-data)
   * Use this for file uploads where you need to control the FormData directly
   */
  async postForm<T = unknown>(
    path: string,
    formData: FormData,
    headers?: Record<string, string>
  ): Promise<TestResponse<T>> {
    const app = await getApp();
    const req = new Request(`${BASE_URL}${path}`, {
      method: "POST",
      body: formData,
      headers: headers || {},
    });
    const response = await app.fetch(req);
    let body: T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      body = (await response.json()) as T;
    } else {
      body = (await response.text()) as unknown as T;
    }
    return {
      status: response.status,
      body,
      headers: response.headers,
    };
  }
}

export const testClient = new TestClient();
