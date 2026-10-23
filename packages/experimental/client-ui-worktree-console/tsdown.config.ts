import { clientBundle } from '../../client/tsdown.client.ts'

// The directory, not the package name: `clientBundle` reads the manifest from
// the path it is handed, so a name resolves to a directory that does not exist
// and the client-packages gate fails before it bundles anything.
export default clientBundle(import.meta.dirname, ['lib/types/index.js'])
