// globalTeardown: stops and removes the containers jest-containers.js started.
export default () => Promise.all((globalThis.testContainers ?? []).map((container) => container.stop()));
