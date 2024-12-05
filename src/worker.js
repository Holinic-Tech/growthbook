import { handleRequest } from '@growthbook/edge-cloudflare';

export default {
 fetch: async function (request, env, ctx) {
   const url = new URL(request.url);
   
   // Prevent infinite loops
   if (request.headers.get('cf-worker') === 'true') {
     return fetch(request);
   }

   // Set PROXY_TARGET dynamically based on the incoming request
   env.PROXY_TARGET = `https://${url.hostname}`;

   // Add worker header to prevent loops
   const newRequest = new Request(request, {
     headers: {
       ...Object.fromEntries(request.headers),
       'cf-worker': 'true'
     }
   });

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
               domain: url.hostname,
               timestamp: new Date().toISOString(),
               $browser: request.headers.get('user-agent'),
               environment: env.ENVIRONMENT || 'production'
             }
           })
         });
       } catch (error) {
         console.error('Mixpanel tracking error:', error);
       }
     },

     // Additional attributes for targeting
     attributes: async (request) => {
       const url = new URL(request.url);
       const userAgent = request.headers.get('user-agent') || '';
       const cookies = request.headers.get('cookie') || '';
       
       // UTM parameters
       const utm_source = url.searchParams.get('utm_source');
       const utm_medium = url.searchParams.get('utm_medium');
       const utm_campaign = url.searchParams.get('utm_campaign');

       // Device detection
       const isMobile = /Mobile|Android|iPhone/i.test(userAgent);
       
       return {
         path: url.pathname,
         hostname: url.hostname,
         subdomain: url.hostname.split('.')[0],
         utm_source,
         utm_medium,
         utm_campaign,
         deviceType: isMobile ? 'mobile' : 'desktop',
       };
     },

     // User ID management
     getUserId: async (request) => {
       const cookies = request.headers.get('cookie') || '';
       const userIdMatch = cookies.match(/gbuuid=([^;]+)/);
       return userIdMatch ? userIdMatch[1] : null;
     }
   };

   // Start with a test path to ensure everything works
   if (url.pathname.startsWith('/gb-test')) {
     try {
       console.log('Processing GrowthBook request for:', url.hostname);
       return await handleRequest(newRequest, env, config);
     } catch (error) {
       console.error('GrowthBook error:', error);
       // Fallback to normal request if GrowthBook fails
       return fetch(request);
     }
   }

   // For all other paths, pass through normally for now
   return fetch(request);
 }
};
