import { handleRequest } from '@growthbook/edge-cloudflare';

export default {
    fetch: async function (request, env, ctx) {
        console.log('Worker triggered:', request.url);
                console.log('Incoming request URL:', request.url);
        console.log('Request headers:', Object.fromEntries(request.headers));

        const url = new URL(request.url);
        const cookies = request.headers.get('cookie') || '';
        console.log('All cookies received:', cookies);

        const gbCookie = cookies.match(/growthbook=([^;]+)/)?.[1] || "";
        const userIdMatch = cookies.match(/gbuuid=([^;]+)/);
        const userId = userIdMatch ? userIdMatch[1] : '';

        // Add detailed logging for Mixpanel cookie extraction
        const mpDistinctIdMatch = cookies.match(/mp_distinct_id=([^;]+)/);
        console.log('Mixpanel cookie match result:', mpDistinctIdMatch);
        
        const mpDistinctId = mpDistinctIdMatch ? mpDistinctIdMatch[1] : null;
        console.log('Extracted Mixpanel distinct ID:', mpDistinctId);

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
                try {
                    const trackData = {
                        event: '$experiment_started',
                        properties: {
                            "Experiment name": experiment.key,
                            "Variant name": result.variationId,
                            $source: "growthbook",
                            token: env.MIXPANEL_TOKEN
                        }
                    };

                    // Add distinct_id if available from cookie
                    if (mpDistinctId) {
                        console.log('Adding Mixpanel distinct ID to track event:', mpDistinctId);
                        trackData.properties.distinct_id = mpDistinctId;
                    } else {
                        console.log('No Mixpanel distinct ID available for track event');
                    }

                    console.log('Sending track data to Mixpanel:', JSON.stringify(trackData));

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
                    // Add Mixpanel distinct ID to attributes if available
                    mixpanel_distinct_id: mpDistinctId || undefined
                };

                console.log('GB Attributes:', attrs);
                return attrs;
            },

            getUserId: async (request) => {
                console.log('GB User ID:', userId);
                return userId;
            },
        };

        let response;
        try {
            response = await handleRequest(newRequest, env, config);

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
                return new Response(response.body, {
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
