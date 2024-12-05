import { handleRequest } from '@growthbook/edge-cloudflare';

export default {
 fetch: async function (request, env, ctx) {
   console.log('Worker triggered:', request.url);
   
   const url = new URL(request.url);
   const cookies = request.headers.get('cookie') || '';
   const gbCookie = cookies.match(/growthbook=[^;]+/)?.[0];
   const userIdMatch = cookies.match(/gbuuid=([^;]+)/);
   
   // CORS headers
   const corsHeaders = {
     'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
     'Access-Control-Allow-Headers': '*'
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Allow-Credentials': 'true'
   };

   // Handle preflight
   if (request.method === 'OPTIONS') {
     return new Response(null, { headers: corsHeaders });
   }

   // Prevent infinite loops
   if (request.headers.get('cf-worker') === 'true') {
     return fetch(request);
   }

   env.PROXY_TARGET = `https://${url.hostname}`;

   const newRequest = new Request(request, {
     headers: {
       ...Object.fromEntries(request.headers),
       'cf-worker': 'true'
     }
   });

   const config = {
     enableVisualEditor: true,
     enableUrlRedirects: true,
     enableSticky: true,
     enableStreaming: true,
     
     edgeTrackingCallback: async (experiment, result) => {
       try {
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

     attributes: async (request) => {
       const url = new URL(request.url);
       const userAgent = request.headers.get('user-agent') || '';
       
       const utm_source = url.searchParams.get('utm_source');
       const utm_medium = url.searchParams.get('utm_medium');
       const utm_campaign = url.searchParams.get('utm_campaign');
       const isMobile = /Mobile|Android|iPhone/i.test(userAgent);
       
       return {
         path: url.pathname,
         hostname: url.hostname,
         subdomain: url.hostname.split('.')[0],
         utm_source,
         utm_medium,
         utm_campaign,
         deviceType: isMobile ? 'mobile' : 'desktop',
         gbCookie,
         userAgent
       };
     },

     getUserId: async (request) => {
       return userIdMatch ? userIdMatch[1] : null;
     }
   };

   if (url.pathname.startsWith('/gb-test')) {
     try {
       if (url.pathname === '/gb-test/' || url.pathname === '/gb-test') {
         return new Response(`
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
               </div>
             </body>
           </html>
         `, {
           headers: {
             'Content-Type': 'text/html',
              'Content-Security-Policy': "frame-ancestors 'self' https://app.growthbook.io",
             ...corsHeaders
           }
         });
       }
       
       const res = await handleRequest(newRequest, env, config);
       return new Response(res.body, {
         status: res.status,
         headers: {
           ...Object.fromEntries(res.headers),
           ...corsHeaders
         }
       });
     } catch (error) {
       console.error('GrowthBook error:', error);
       return fetch(request);
     }
   }

   const response = await fetch(request);
   return new Response(response.body, {
     status: response.status,
     headers: {
       ...Object.fromEntries(response.headers),
      'Content-Security-Policy': "frame-ancestors 'self' https://app.growthbook.io",
       ...corsHeaders
     }
   });
 }
};
