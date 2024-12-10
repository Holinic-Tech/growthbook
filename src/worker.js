import { handleRequest } from '@growthbook/edge-cloudflare';

export default {
  fetch: async function (request, env, ctx) {
    console.log('Worker triggered:', request.url);

    const url = new URL(request.url);
    const cookies = request.headers.get('cookie') || '';
    const gbCookie = cookies.match(/growthbook=([^;]+)/)?.[1] || ""; // Extract only the value
    const userIdMatch = cookies.match(/gbuuid=([^;]+)/);
    const userId = userIdMatch ? userIdMatch[1] : 'anonymous';

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Allow-Credentials': 'true',
    };

    const cspHeaders = {
      'Content-Security-Policy': "frame-ancestors https://app.growthbook.io",
      'X-Frame-Options': 'ALLOW-FROM https://app.growthbook.io',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...corsHeaders, ...cspHeaders },
      });
    }

    if (request.headers.get('cf-worker') === 'true') {
      return fetch(request);
    }

    env.PROXY_TARGET = `https://${url.hostname}`;

    // Reconstruct the body if it's a POST/PUT request
    let body = null;
    if (request.method === "POST" || request.method === "PUT") {
      try {
        body = await request.clone().text(); // Clone and read the body
      } catch (error) {
        console.error("Error reading request body:", error);
      }
    }

    const newRequest = new Request(request.url, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'cf-worker': 'true', // Prevent infinite loops
      },
      body: body, // Use reconstructed body
    });

    console.log('Request forwarding check', newRequest);

    // GrowthBook configuration
    const config = {
      enableVisualEditor: true,
      enableUrlRedirects: true,
      enableSticky: true,
      enableStreaming: true,
      enableDevMode: true,
      apiHost: env.GROWTHBOOK_API_HOST || 'https://cdn.growthbook.io',
      clientKey: env.GROWTHBOOK_CLIENT_KEY,

      trackingCallback: (experiment, result) => {
        console.log('GB Tracking:', experiment, result);
      },

      onFeatureUsage: (key, value) => {
        console.log('GB Feature:', key, value);
      },

      edgeTrackingCallback: async (experiment, result) => {
        console.log('Edge Tracking Callback:', experiment.key, result);
        try {
          await fetch('https://api.mixpanel.com/track', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${btoa(env.MIXPANEL_TOKEN + ':')}`,
            },
            body: JSON.stringify({
              event: 'Experiment Viewed',
              properties: {
                token: env.MIXPANEL_TOKEN,
                distinct_id: userId,
                experiment_id: experiment.key,
                variation_id: result.variationId,
                variation_value: result.value,
                in_experiment: result.inExperiment,
                url: request.url,
                domain: url.hostname,
                timestamp: new Date().toISOString(),
                $browser: request.headers.get('user-agent'),
                environment: env.ENVIRONMENT || 'production',
              },
            }),
          });
        } catch (error) {
          console.error('Mixpanel tracking error:', error);
        }
      },

      attributes: async (request) => {
        const userAgent = request.headers.get('user-agent') || '';
        const utm_source = url.searchParams.get('utm_source');
        const utm_medium = url.searchParams.get('utm_medium');
        const utm_campaign = url.searchParams.get('utm_campaign');
        const isMobile = /Mobile|Android|iPhone/i.test(userAgent);

        const attrs = {
          path: url.pathname,
          hostname: url.hostname,
          subdomain: url.hostname.split('.')[0],
          utm_source,
          utm_medium,
          utm_campaign,
          deviceType: isMobile ? 'mobile' : 'desktop',
          gbCookie,
          userAgent,
          url: request.url,
        };

        console.log('GB Attributes:', attrs);
        return attrs;
      },

      getUserId: async (request) => {
        console.log('GB User ID:', userId);
        return userId;
      },
    };

    console.log('GB Config:', {
      ...config,
      apiHost: env.GROWTHBOOK_API_HOST,
      clientKey: env.GROWTHBOOK_CLIENT_KEY,
      path: url.pathname,
    });

    if (url.pathname.startsWith('/gb-test')) {
      try {
        if (url.pathname === '/gb-test/' || url.pathname === '/gb-test') {
          return new Response(
            `
            <html>
              <head>
                <title>GrowthBook Test Page</title>
                <style>
                  body { font-family: Arial, sans-serif; margin: 40px; }
                  .container { max-width: 800px; margin: 0 auto; }
                  .status { padding: 20px; background: #e8f5e9; border-radius: 8px; margin: 20px 0; }
                  .info { background: #e3f2fd; padding: 20px; border-radius: 8px; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>GrowthBook Test Page</h1>
                  <div class="status">
                    <h2>✅ Worker Status</h2>
                    <p>Worker is successfully running on: <strong>${url.hostname}</strong></p>
                  </div>
                  <div class="info">
                    <h2>ℹ️ Environment Information</h2>
                    <ul>
                      <li>Hostname: ${url.hostname}</li>
                      <li>Path: ${url.pathname}</li>
                      <li>Time: ${new Date().toISOString()}</li>
                    </ul>
                  </div>
                  <p>This page is ready for GrowthBook experiments!</p>
                  <div id="gb-status"></div>
                </div>
                <script>
                  console.log('GrowthBook Test Page Loaded');
                  const statusDiv = document.getElementById('gb-status');
                  statusDiv.textContent = 'GrowthBook Status: ' +
                    (window.location.search.includes('growthbook=true') ? 'Editor Enabled' : 'Editor Not Enabled');
                </script>
              </body>
            </html>
          `,
            {
              headers: {
                'Content-Type': 'text/html',
                ...corsHeaders,
                ...cspHeaders,
              },
            }
          );
        }

        const res = await handleRequest(newRequest, env, config);
        return new Response(res.body, {
          status: res.status,
          headers: {
            ...Object.fromEntries(res.headers),
            ...corsHeaders,
            ...cspHeaders,
          },
        });
      } catch (error) {
        console.error('GrowthBook error:', error);
        return fetch(request);
      }
    }

    let response;
    try {
      response = await handleRequest(newRequest, env, config);
    } catch (error) {
      console.error('Error forwarding request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        ...corsHeaders,
        ...cspHeaders,
      },
    });
  },
};
