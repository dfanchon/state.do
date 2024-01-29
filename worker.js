const State = require('./state.js').default
exports.State = State

exports.handlers = {

  async fetch(request, env) {
    return await handleErrors(request, async () => {
      // We have received an HTTP request! Parse the URL and route the request.

      let url = new URL(request.url);
      let path = url.pathname.slice(1).split('/');

       // The path structure should be /machine/machine_name/[event|reset]

      if (!path[0]) {
        // Serve our HTML at the root path.
        return new Response('It works!', {headers: {"Content-Type": "text/html;charset=UTF-8"}});
      }

      if (!path[1]) {
        return new Response("You must provide a machine name", {status: 500});
      } else {
        return handleApiRequest(path, request, env);
      }

    });
  }
}

async function handleErrors(request, func) {
  try {
    return await func();
  } catch (err) {
    if (request.headers.get("Upgrade") == "websocket") {
      // Annoyingly, if we return an HTTP error in response to a WebSocket request, Chrome devtools
      // won't show us the response body! So... let's send a WebSocket response with an error
      // frame instead.
      let pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({error: err.stack}));
      pair[1].close(1011, "Uncaught exception during client session setup");
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      return new Response(err.stack, {status: 500});
    }
  }
}

async function handleApiRequest(path, request, env) {

  // We've received at API request. Route the request based on the path.
  let machine = path[1];
  // Route the request to the Machine DO
  let name = machine;
  // The DO Id is derived from the name
  let id = env.collections.idFromName(name);
  // Get the Durable Object stub
  let durableObject = env.machines.get(id);
  // Send the request to the object
  return durableObject.fetch(request);

}