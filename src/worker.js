import { handleRequest } from '@growthbook/edge-cloudflare';

function injectServiceWorkerCode(html) {
    const swCode = `
        <script>
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', async () => {
                    try {
                        const registration = await navigator.serviceWorker.register('/sw.js', {
                            scope: '/'
                        });
                        console.log('ServiceWorker registration successful');
                    } catch (error) {
                        console.error('ServiceWorker registration failed:', error);
                    }
                });
            }
        </script>
    `;
    return html.replace('</head>', `${swCode}</head>`);
}

export default {
    fetch: async function (request, env, ctx) {
        console.log('Worker triggered:', request.url);

        const url = new URL(request.url);
        const cookies = request.headers.get('cookie') || '';
        const gbCookie = cookies.match(/growthbook=([^;]+)/)?.[1] || "";
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

        let body = null;
        if (request.method === "POST" || request.method === "PUT") {
            try {
                body = await request.clone().text();
            } catch (error) {
                console.error("Error reading request body:", error);
            }
        }

        const newRequest = new Request(request.url, {
            method: request.method,
            headers: {
                ...Object.fromEntries(request.headers),
                'cf-worker': 'true',
            },
            body: body,
        });

        console.log('Request forwarding check', newRequest);

        const config = {
            enableVisualEditor: true,
            enableUrlRedirects: true,
            enableSticky: true,
            enableStreaming: true,
            enableDevMode: true,
            apiHost: env.GROWTHBOOK_API_HOST || 'https://cdn.growthbook.io',
            clientKey: env.GROWTHBOOK_CLIENT_KEY,

            onRedirect: async (redirectUrl) => {
                console.log('Redirect requested to:', redirectUrl);
                return new Response(null, {
                    status: 302,
                    headers: {
                        'Location': redirectUrl,
                        'X-GrowthBook-Redirect': 'true',
                        ...corsHeaders,
                        ...cspHeaders
                    }
                });
            },

            trackingCallback: (experiment, result) => {
                console.log('GB Tracking:', experiment, result);
            },

            onFeatureUsage: (key, value) => {
                console.log('GB Feature:', key, value);
            },

            edgeTrackingCallback: async (experiment, result) => {
                const getBerlinTimestamp = () => {
                    const options = {
                        timeZone: "Europe/Berlin",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: false,
                    };

                    const berlinDate = new Intl.DateTimeFormat("en-GB", options).format(new Date());
                    const [date, time] = berlinDate.split(", ");
                    return `${date.split("/").reverse().join("-")}T${time}+01:00`;
                };

                console.log('Edge Tracking Callback:', experiment.key, result);
                try {
                    const timestamp = Math.floor(Date.now() / 1000);
                    const insertId = `${timestamp}-${Math.random().toString(36).substring(2, 15)}`;

                    const trackData = {
                        event: '$experiment_started',
                        properties: {
                            token: env.MIXPANEL_TOKEN,
                            distinct_id: userId,
                            $insert_id: insertId,
                            "Experiment name": experiment.key,
                            "Variant name": result.variationId,
                            variation_value: result.value,
                            in_experiment: result.inExperiment,
                            url: request.url,
                            logged_in: true,
                            domain: url.hostname,
                            timestamp: getBerlinTimestamp(),
                            timezone: "Europe/Berlin",
                            $browser: request.headers.get('user-agent'),
                            environment: env.ENVIRONMENT || 'production',
                            $source: 'growthbook'
                        },
                    };
                    await fetch('https://api.mixpanel.com/track', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'text/plain',
                        },
                        body: JSON.stringify([trackData]),
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
                    logged_in: true,
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
            } catch (error) {
                console.error('GrowthBook error:', error);
                return fetch(request);
            }
        }

        let response;
        try {
            response = await handleRequest(newRequest, env, config);
            
            // Only modify HTML responses
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
                let html = await response.text();
                html = injectServiceWorkerCode(html);
                
                return new Response(html, {
                    status: response.status,
                    headers: {
                        ...Object.fromEntries(response.headers),
                        ...corsHeaders,
                        ...cspHeaders,
                        'Content-Type': 'text/html',
                    },
                });
            }
            
            return new Response(response.body, {
                status: response.status,
                headers: {
                    ...Object.fromEntries(response.headers),
                    ...corsHeaders,
                    ...cspHeaders,
                },
            });
        } catch (error) {
            console.error('Error forwarding request:', error);
            return new Response('Internal Server Error', { status: 500 });
        }
    },
};
