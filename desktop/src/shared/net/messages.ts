/** Messages with the network utility process (OSC in/out + remote web control server). */

export interface RemoteState {
  showName: string;
  playing: boolean;
  blackout: boolean;
  scenes: { id: string; name: string; active: boolean; preview: boolean }[];
  cues: { id: string; name: string; active: boolean }[];
  /** Params exposed on the remote surface. */
  params: { id: string; name: string; value: number; min: number; max: number; type: string }[];
  timecode: string;
  fps: number;
  dmxOk: boolean;
}

export interface NetConfig {
  osc: { enabled: boolean; inPort: number; outHost: string; outPort: number };
  remote: { enabled: boolean; port: number; pin: string };
  /** Static files of the remote web app. */
  remoteRoot: string;
}

export type ToNet =
  | { type: 'config'; config: NetConfig }
  | { type: 'oscSend'; address: string; args: (number | string | boolean)[] }
  | { type: 'remoteState'; state: RemoteState }
  | { type: 'remoteParam'; id: string; value: number };

export type RemoteCommand =
  | { cmd: 'transport'; action: 'play' | 'pause' | 'stop' | 'next' | 'previous' }
  | { cmd: 'scene'; id: string }
  | { cmd: 'cue'; id: string }
  | { cmd: 'param'; id: string; value: number }
  | { cmd: 'blackout'; on: boolean }
  | { cmd: 'take' };

export type FromNet =
  | { type: 'osc'; address: string; args: (number | string | boolean | null)[]; from: string }
  | { type: 'remote'; command: RemoteCommand; client: string }
  | { type: 'status'; osc: { listening: boolean; port: number; error: string | null; messagesPerSec: number }; remote: { listening: boolean; urls: string[]; clients: number; error: string | null } }
  | { type: 'log'; message: string };
