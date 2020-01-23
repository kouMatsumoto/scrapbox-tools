import { waitUntil } from '../../../common';
import { ID } from '../../public-api';
import { CommitChangeParam, createChanges } from './internal/commit-change-param';
import { extractMessage } from './websocket-client-internal-functions';
import { ConnectionOpenMessage, ReceivedMessage, SendMessage } from './websocket-client-types';

const endpoint = 'wss://scrapbox.io/socket.io/?EIO=3&transport=websocket';
const sendProtocol = '42';
const receiveProtocol = '43';
const websocketResponseTimeoutMs = 1000 * 30;

export class WebsocketClient {
  private readonly socket: WebSocket;
  // need buffer if try to send until connection opened
  private sendBuffer: Function[] = [];
  private senderId = 0;
  /**
   * if map.get(key) === undefined, message sent and response unreceived
   * if map.get(key) !== undefined, message sent and response received
   */
  private receivePool = new Map<string, ReceivedMessage | undefined>();

  constructor(private readonly userId: ID) {
    this.socket = new WebSocket(endpoint);
    this.initialize();
  }

  commit(param: { projectId: string; userId: ID; pageId: string; parentId: string; changes: CommitChangeParam[] }) {
    return this.send({
      method: 'commit',
      data: {
        kind: 'page',
        userId: this.userId,
        projectId: param.projectId,
        pageId: param.pageId,
        parentId: param.parentId,
        changes: createChanges(param.changes),
        cursor: null,
        freeze: true,
      },
    });
  }

  joinRoom(param: { projectId: string; pageId: string }) {
    return this.send({
      method: 'room:join',
      data: {
        pageId: param.pageId,
        projectId: param.projectId,
        projectUpdatesStream: false,
      },
    });
  }

  private async send(payload: SendMessage): Promise<ReceivedMessage> {
    const body = JSON.stringify(['socket.io-request', payload]);
    const senderId = `${this.senderId++}`;
    const data = `${sendProtocol}${senderId}${body}`;

    if (this.socket.readyState !== WebSocket.OPEN) {
      this.sendBuffer.push(() => this.socket.send(data));
    } else {
      this.socket.send(data);
    }

    this.receivePool.set(senderId, undefined);
    await waitUntil(() => this.receivePool.get(senderId) !== undefined, 10, websocketResponseTimeoutMs);

    const result = this.receivePool.get(senderId) || null;
    this.receivePool.delete(senderId);

    return result as ReceivedMessage;
  }

  /**
   * Connect to websocket and register events.
   */
  private initialize() {
    this.socket.addEventListener('open', (event: Event) => {
      console.log('[websocket-client] connection opened ', event);
    });

    this.socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        throw new Error('unexpected data received');
      }

      const message = event.data;
      const [header, body] = extractMessage(message);
      console.log('[websocket-client] message', header, body);

      // message just after connection opened
      if (header === '0') {
        this.handleOpen(body as ConnectionOpenMessage);
      }
      // for send()
      if (header.startsWith(receiveProtocol)) {
        const senderId = header.slice(receiveProtocol.length);
        this.receivePool.set(senderId, body);
      }
    });

    this.socket.addEventListener('close', (event: CloseEvent) => {
      // maybe closed by server
      console.error('[websocket-client] connection closed ', event);
    });

    this.socket.addEventListener('error', (event: any) => {
      console.error('[websocket-client] connection errored ', event);
    });
  }

  private handleOpen(message: ConnectionOpenMessage) {
    // setup ping
    setInterval(() => {
      this.socket.send('2');
    }, message.pingInterval);

    // consume buffer
    this.sendBuffer.forEach((f) => f());
    this.sendBuffer = [];
  }
}
