import { handleRequest } from '@growthbook/edge-cloudflare';

export default {
  fetch: async function (request, env, ctx) {
    const config = {
      // Enable all GrowthBook features
      enableVisualEditor: true,
      enableUrlRedirects: true,
      enableSticky: true,
      enableStreaming: true,
      
      // Mixpanel tracking integration
      edgeTrackingCallback: async (experiment, result) => {
        try {
          // Get user ID from cookie or generate anonymous one
          const cookies = request.headers.get('cookie') || '';
          const userIdMatch = cookies.match(/gbuuid=([^;]+)/);
          const userId = userIdMatch ? userIdMatch[1] : 'anonymous';

          await fetch('https://api.mixpanel.com/track', {
            method: 'POST',
            headers: {
              'Accept': 'text/plain',
              'Content-Type': 'application/json',
              'Authorization': `Basic ${btoa(env.MIXPANEL_TOKEN + ':')}`
            },
            body: JSON.stringify({
              event: "Experiment Viewed",
              properties: {
                token: env.MIXPANEL_TOKEN,
                distinct_id: userId,
                experiment_id: experiment.key,
                variation_id: result.variationId,
                variation_value: result.value,
                in_experiment: result.inExperiment,
                url: request.url,
                timestamp: new Date().toISOString(),
                $browser: request.headers.get('user-agent'),
                environment: env.ENVIRONMENT || 'production'
              }
            })
          });
        } catch (error) {
          // Log errors but don't break the experience
          console.error('Mixpanel tracking error:', error);
        }
      },

      // Optional: Add any additional attributes you want to use for targeting
      attributes: async (request) => {
        const url = new URL(request.url);
        const userAgent = request.headers.get('user-agent') || '';
        const cookies = request.headers.get('cookie') || '';
        
        // Example of extracting UTM parameters
        const utm_source = url.searchParams.get('utm_source');
        const utm_medium = url.searchParams.get('utm_medium');
        const utm_campaign = url.searchParams.get('utm_campaign');

        // Example of device detection
        const isMobile = /Mobile|Android|iPhone/i.test(userAgent);
        
        return {
          path: url.pathname,
          hostname: url.hostname,
          utm_source,
          utm_medium,
          utm_campaign,
          deviceType: isMobile ? 'mobile' : 'desktop',
          // Add any other attributes you want to use for targeting
        };
      },

      // Optional: Customize how user IDs are generated
      getUserId: async (request) => {
        const cookies = request.headers.get('cookie') || '';
        const userIdMatch = cookies.match(/gbuuid=([^;]+)/);
        return userIdMatch ? userIdMatch[1] : null;
      }
    };

    return await handleRequest(request, env, config);
  }
};
