import { createMachine, interpret } from 'xstate'
import { error, json, Router, withParams, withContent } from 'itty-router'

export class Machine {
  state
  env
  /** @type {import('xstate').MachineConfig} */
  machineDefinition
  /** @type {import('xstate').StateValue} */
  machineState
  /** @type {import('xstate').StateMachine} */
  machine
  /** @type {import('xstate').Interpreter} */
  service
  /** @type {import('xstate').State} */
  serviceState

  constructor(state, env) {

    // Get durable storage
    this.storage = state.storage;

    // Get Environment bindings
    this.env = env;

    // Get state
    this.state = state;

    // Create router
    this.router = Router();

    this.router
      .post('*', withParams, withContent)
      .post('/machine/:machine', async ({ machine, content }) => {
        /*
        let url = new URL(request.url);
        let path = url.pathname.slice(1).split('/');
        this.machine = path[0];
        */
        this.machine = machine;
        console.log('machine: ' + this.machine);
        //let machineDefinition = await request.json();
        let machineDefinition = content;
        console.log('machineDefinition: ' + machineDefinition);
        if (!machineDefinition) {
          throw new Error("Incorrect syntax, the body should be a json");
        }
        await this.update(machineDefinition);
        console.log('machineDefinition: ' + this.machineDefinition);
        let retval = {
          machineDefinition: this.machineDefinition,
          state: this.state
        }
        return new Response(JSON.stringify(retval, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
      })
    /*
    .post('/machine/:machine/:event', ({ machine, event }) => {
      this.service.send({ type: event });
    })
    */

    state.blockConcurrencyWhile(async () => {
      [this.machineDefinition, this.machineState] = await Promise.all([this.storage.get('machineDefinition'), this.storage.get('machineState')])
      if (this.machineDefinition) {
        this.startMachine(this.machineState)
      }
    })
  }

  /**
   * @param {import('xstate').StateValue|undefined} state
   */
  startMachine(state) {
    this.machine = createMachine(this.machineDefinition)
    this.service = interpret(this.machine)
    this.service.onTransition(async (state) => {
      this.serviceState = state
      if (this.machineState === state.value) return
      await this.storage.put('machineState', (this.machineState = state.value))
      const meta = Object.values(state.meta)[0]
      const callback = meta?.callback || state.configuration.flatMap((c) => c.config).reduce((acc, c) => ({ ...acc, ...c }), {}).callback
      if (callback) {
        const callbacks = Array.isArray(callback) ? callback : [callback]
        for (let i = 0; i < callbacks.length; i++) {
          const url = typeof callbacks[i] === 'string' || callbacks[i] instanceof String ? callbacks[i] : callbacks[i].url
          const init = callbacks[i].init || meta?.init || {}
          init.headers = callbacks[i].headers || meta?.headers || init.headers || {}
          // Check if the callback has a body (cascade: callback > meta > init > event)
          const body = callbacks[i].body || meta?.body
          // If the callback has a body, set it and set the method to POST
          if (body) init.body = JSON.stringify(body)
          init.method = callbacks[i].method || meta?.method || init.method || init.body ? 'POST' : 'GET'
          // If a method requests abody but doesn't have one, stringify the event and set the content-type to application/json
          if (!init.body && ['POST', 'PUT', 'PATCH'].includes(init.method)) init.body = JSON.stringify(state.event)
          if (init.body && !init.headers['content-type']) init.headers['content-type'] = 'application/json'
          console.log({ url, init, state })
          const data = await fetch(url, init)
          // Escape special regex characters and replace x with \d to check if the callback status code matches an event (e.g. 2xx)
          const event = state?.nextEvents.find((e) => data.status.toString().match(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/x/gi, '\\d'))))
          this.service.send(event || data.status.toString(), await data.json())
        }
      }
    })
    try {
      this.service.start(state)
    } catch (error) {
      // Machines with new definitions that have incompatible states can't recycle the old state
      this.reset()
    }
  }

  async reset() {
    // Stop the service and reset the state before restarting it
    this.service?.stop()
    this.service = undefined
    this.serviceState = undefined
    if (this.machineState) {
      this.machineState = undefined
      await this.storage.delete('machineState')
    }
    // Restart the service
    if (this.machineDefinition) this.startMachine()
  }

  /**
   * @param {import('xstate').MachineConfig} machineDefinition
   */
  async update(machineDefinition) {
    // Don't update if the new definition is empty or hasn't changed
    if (!machineDefinition || machineDefinition === this.machineDefinition) return
    this.service?.stop()
    await this.storage.put('machineDefinition', (this.machineDefinition = machineDefinition))
    this.startMachine(this.machineState)
  }

  /**
   * @param {Request} req
   */
  async fetch(req) {
    const response = await this.router.handle(req);
    return response;
  }



  /*
      let url = new URL(request.url);
      let path = url.pathname.slice(1).split('/');
      let method = request.method;
      this.machine = path[0];
      
      switch (method) {
        case "GET":
          break;
        case "POST":
          let machineDefinition = await request.json();
          if (!machineDefinition) {
            throw new Error("Incorrect syntax, the body should be a json");
          }
          await this.update(machineDefinition);
          break;
        default:
          throw new Error("Incorrect syntax");
      }
  
      let retval = {
        machineDefinition: this.machineDefinition,
        state: this.state
      }
      return new Response(JSON.stringify(retval, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  */

  /*
  let { user, redirect, method, origin, pathSegments, search, json } = await this.env.CTX.fetch(req).then((res) => res.json())
  if (redirect) return Response.redirect(redirect)
  const [instance, stateEvent] = pathSegments
  const update = '?update='
  const isSearchBasedUpdate = search.startsWith(update)
  const retval = {
      api: {
          icon: '●→',
          name: 'state.do',
          description: 'Finite State Machine implementation with Durable Objects based on xstate',
          url: 'https://state.do/',
          type: 'https://apis.do/state',
          endpoints: {
              create: origin + '/:key?{state_machine}',
              reset: origin + '/:key?reset',
              update: origin + '/:key?update={state_machine}',
              read: origin + '/:key',
              event: origin + '/:key/:event',
          },
          site: 'https://state.do',
          repo: 'https://github.com/drivly/state.do',
      },
      instance,
  }
  if (search === '?reset') {
      await this.reset()
  } else if (search.startsWith('?import=')) {
      const machine = await fetch(decodeURIComponent(search.substring('?import='.length))).then((res) => res.json())
      await this.update(machine)
  } else if (search === '?machine') {
      if (this.machineDefinition) retval.machine = this.machineDefinition
      retval.user = user
      return new Response(JSON.stringify(retval, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } })
  } else if ((search && (!this.machineDefinition || isSearchBasedUpdate)) || (method === 'POST' && json?.states)) {
      await this.update((search && JSON.parse(decodeURIComponent(search.substring(isSearchBasedUpdate ? update.length : 1)))) || json)
  } else {
      if (json) console.log(json)
      if (stateEvent) this.service?.send(stateEvent, json)
      else if (json) this.service?.send(json)
  }
  retval.state = this.machineState
  if (this.serviceState?.nextEvents && this.serviceState.nextEvents.length)
      retval.events = this.serviceState.nextEvents.map((e) => `${origin}/${instance}/${encodeURIComponent(e)}`)
  retval.user = user
  return new Response(JSON.stringify(retval, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } })
  */
}

export default {

  async fetch(request, env) {
    return await handleErrors(request, async () => {
      // We have received an HTTP request! Parse the URL and route the request.

      let url = new URL(request.url);
      let path = url.pathname.slice(1).split('/');

      // The path structure should be /machine/machine_name/[event|reset]

      if (!path[0]) {
        // Serve our HTML at the root path.
        return new Response('It works!', { headers: { "Content-Type": "text/html;charset=UTF-8" } });
      }

      if (!path[1]) {
        return new Response("You must provide a machine name", { status: 500 });
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
      pair[1].send(JSON.stringify({ error: err.stack }));
      pair[1].close(1011, "Uncaught exception during client session setup");
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      return new Response(err.stack, { status: 500 });
    }
  }
}

async function handleApiRequest(path, request, env) {

  // We've received at API request. Route the request based on the path.

  // Route the request to the Machine DO
  let machine = path[1];
  console.log(machine);
  // The DO Id is derived from the name
  let id = env.machines.idFromName(machine);
  // Get the Durable Object stub
  let durableObject = env.machines.get(id);
  // Send the request to the object
  return durableObject.fetch(request);

}