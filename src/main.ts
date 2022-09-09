import * as utils from '@iobroker/adapter-core';
import { LOQED } from 'loqed-api';

class Loqed extends utils.Adapter {
    private loqedClient: LOQED | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'loqed'
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        let loqedConfig: Record<string, any>;
        try {
            loqedConfig = JSON.parse(this.config.loqedConfig);
        } catch {
            this.log.error(`Could not parse LOQED config (${this.config.loqedConfig}), please ensure it is valid`);
            return;
        }

        this.subscribeStates('*');

        this.config.port = await this.getPortAsync(this.config.port);

        this.loqedClient = new LOQED({
            bridgeKey: loqedConfig.bridge_key,
            apiKey: loqedConfig.backend_key,
            ip: loqedConfig.bridge_ip,
            lockId: loqedConfig.lock_key_local_id,
            port: this.config.port
        });

        this.config.callbackUrl = `${this.config.callbackUrl}:${this.config.port}/`;

        await this.ensureWebhookRegistered();
        await this.syncStatus();

        this.loqedClient.on('STATE_CHANGED', state => {
            this.log.info(`State changed to ${state}`);
        });

        this.loqedClient.on('GO_TO_STATE', state => {
            this.log.info(`Lock tries to go to ${state}`);
        });

        this.loqedClient.on('UNKNOWN_EVENT', data => {
            this.log.warn(`Unknown event: ${JSON.stringify(data)}`);
        });
    }

    /**
     * Get states from lock and sync them to states
     */
    private async syncStatus(): Promise<void> {
        try {
            const status = await this.loqedClient!.getStatus();

            await this.extendForeignObjectAsync(this.namespace, {
                // @ts-expect-error issue already exists
                type: 'device',
                common: {
                    name: 'LOQED lock'
                },
                native: status
            });

            await this.setStateAsync('info.connection', !!status.lock_online, true);
            await this.setStateAsync('lockStatus.batteryPercentage', status.battery_percentage, true);
            await this.setStateAsync('lockMotor.goToPosition', status.bolt_state, true);
            await this.setStateAsync('lockMotor.currentPosition', status.bolt_state, true);
        } catch (e: any) {
            this.log.error(`Could not sync status: ${e.message}`);
        }
    }

    /**
     * Ensure that we have a callback registered
     */
    private async ensureWebhookRegistered(): Promise<void> {
        try {
            const webhooks = await this.loqedClient!.listWebhooks();

            const webhookRegistered = webhooks.find(entry => entry.url === this.config.callbackUrl);

            if (webhookRegistered) {
                this.log.info(`Webhook for our application already registered with id ${webhookRegistered.id}`);
            } else {
                this.log.info('No matching webhook found, registering one now');
                await this.loqedClient!.registerWebhook(this.config.callbackUrl);
            }
        } catch (e: any) {
            this.log.error(`Could not ensure, that webhook is registered: ${e.message}`);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private async onUnload(callback: () => void): Promise<void> {
        try {
            if (this.loqedClient) {
                await this.loqedClient.stopServer();
            }

            callback();
        } catch {
            callback();
        }
    }
    /**
     * Is called if a subscribed state changes
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            // state deleted or already acked
            return;
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Loqed(options);
} else {
    (() => new Loqed())();
}