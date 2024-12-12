// sw.js
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('Location');
            if (location) {
              console.log('SW intercepting redirect to:', location);
              const redirectResponse = await fetch(location, {
                redirect: 'manual',
                credentials: 'include'
              });
              return redirectResponse;
            }
          }
          return response;
        })
    );
  }
});
