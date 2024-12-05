import { handleRequest } from '@growthbook/edge-cloudflare';

export default {
  fetch: async function (request, env, ctx) {
    const config = {
      edgeTrackingCallback: async (experiment, result) => {
        // Track the experiment view in Mixpanel
        try {
          await fetch('https://api.mixpanel.com/track', {
            method: 'POST',
            headers: {
              'Accept': 'text/plain',
              'Content-Type': 'application/json',
              // Add your Mixpanel project token
              'Authorization': `Basic ${btoa(env.MIXPANEL_TOKEN + ':')}` 
            },
            body: JSON.stringify({
              event: "Experiment Viewed",
              properties: {
                token: env.MIXPANEL_TOKEN,
                distinct_id: result.user?.id || 'anonymous',
                experiment_id: experiment.key,
                variation_id: result.variationId,
                in_experiment: result.inExperiment,
                timestamp: new Date().toISOString()
              }
            })
          });
        } catch (error) {
          console.error('Mixpanel tracking error:', error);
        }
      }
    };

    return await handleRequest(request, env, config);
  },
};
