class RNode {

    static BAUD_RATE = 115200;

    KISS_FEND = 0xC0;
    KISS_FESC = 0xDB;
    KISS_TFEND = 0xDC;
    KISS_TFESC = 0xDD;

    CMD_FREQUENCY = 0x01;
    CMD_BANDWIDTH = 0x02;
    CMD_TXPOWER = 0x03;
    CMD_SF = 0x04;
    CMD_CR = 0x05;
    CMD_RADIO_STATE = 0x06;

    CMD_STAT_RX = 0x21;
    CMD_STAT_TX = 0x22
    CMD_STAT_RSSI = 0x23;
    CMD_STAT_SNR = 0x24;

    CMD_BOARD = 0x47;
    CMD_PLATFORM = 0x48;
    CMD_MCU = 0x49;
    CMD_RESET = 0x55;
    CMD_RESET_BYTE = 0xF8;
    CMD_DEV_HASH = 0x56;
    CMD_FW_VERSION = 0x50;
    CMD_ROM_READ = 0x51;
    CMD_CONF_SAVE = 0x53;
    CMD_CONF_DELETE = 0x54;
    CMD_HASHES = 0x60;

    CMD_BT_CTRL = 0x46;
    CMD_BT_PIN = 0x62;

    CMD_DETECT = 0x08;

    DETECT_REQ = 0x73;
    DETECT_RESP = 0x46;

    PLATFORM_AVR = 0x90;
    PLATFORM_ESP32 = 0x80;
    PLATFORM_NRF52 = 0x70;

    MCU_1284P = 0x91;
    MCU_2560 = 0x92;
    MCU_ESP32 = 0x81;
    MCU_NRF52 = 0x71;

    BOARD_RNODE = 0x31;
    BOARD_HMBRW = 0x32;
    BOARD_TBEAM = 0x33;
    BOARD_HUZZAH32 = 0x34;
    BOARD_GENERIC_ESP32 = 0x35;
    BOARD_LORA32_V2_0 = 0x36;
    BOARD_LORA32_V2_1 = 0x37;
    BOARD_RAK4631 = 0x51;

    HASH_TYPE_TARGET_FIRMWARE = 0x01;
    HASH_TYPE_FIRMWARE = 0x02;

    constructor() {
        this.readable = null;
        this.writable = null;
    }

    static fromSerialPort(port) {
        const rnode = new RNode();
        rnode.readable = port.readable;
        rnode.writable = port.writable;
        return rnode;
    }

    async write(bytes) {
        const writer = this.writable.getWriter();
        try {
            await writer.write(new Uint8Array(bytes));
        } finally {
            writer.releaseLock();
        }
    }

    async readFromSerialPort() {
        const reader = this.readable.getReader();
        try {
            let buffer = [];
            while(true){
                const { value, done } = await reader.read();
                if(done){
                    break;
                }
                if(value){
                    for(let byte of value){
                        buffer.push(byte);
                        if(byte === this.KISS_FEND){
                            if(buffer.length > 1){
                                return this.handleKISSFrame(buffer);
                            }
                            buffer = [this.KISS_FEND]; // Start new frame
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error reading from serial port: ', error);
        } finally {
            reader.releaseLock();
        }
    }

    handleKISSFrame(frame) {

        let data = [];
        let escaping = false;

        // Skip the initial 0xC0 and process the rest
        for(let i = 1; i < frame.length; i++){
            let byte = frame[i];
            if (escaping) {
                if (byte === this.KISS_TFEND) {
                    data.push(this.KISS_FEND);
                } else if (byte === this.KISS_TFESC) {
                    data.push(this.KISS_FESC);
                }
                escaping = false;
            } else {
                if (byte === this.KISS_FESC) {
                    escaping = true;
                } else if (byte === this.KISS_FEND) {
                    // Ignore the end frame delimiter
                    break;
                } else {
                    data.push(byte);
                }
            }
        }

        console.log('Received KISS frame data:', new Uint8Array(data));
        return data;

    }

    createKissFrame(data) {
        let frame = [this.KISS_FEND];
        for(let byte of data){
            if(byte === this.KISS_FEND){
                frame.push(this.KISS_FESC, this.KISS_TFEND);
            } else if(byte === this.KISS_FESC){
                frame.push(this.KISS_FESC, this.KISS_TFESC);
            } else {
                frame.push(byte);
            }
        }
        frame.push(this.KISS_FEND);
        return new Uint8Array(frame);
    }

    async sendKissCommand(data) {
        await this.write(this.createKissFrame(data));
    }

    async reset() {
        await this.sendKissCommand([
            this.CMD_RESET,
            this.CMD_RESET_BYTE,
        ]);
    }

    async detect() {

        // ask if device is rnode
        await this.sendKissCommand([
            this.CMD_DETECT,
            this.DETECT_REQ,
        ]);

        // read response from device
        const [ command, responseByte ] = await this.readFromSerialPort();

        // device is an rnode if response is as expected
        return command === this.CMD_DETECT && responseByte === this.DETECT_RESP;

    }

    async getFirmwareVersion() {

        await this.sendKissCommand([
            this.CMD_FW_VERSION,
            0x00,
        ]);

        // read response from device
        var [ command, majorVersion, minorVersion ] = await this.readFromSerialPort();
        if(minorVersion.length === 1){
            minorVersion = "0" + minorVersion;
        }

        // 1.23
        return majorVersion + "." + minorVersion;

    }

    async getPlatform() {

        await this.sendKissCommand([
            this.CMD_PLATFORM,
            0x00,
        ]);

        // read response from device
        const [ command, platformByte ] = await this.readFromSerialPort();
        return platformByte;

    }

    async getMcu() {

        await this.sendKissCommand([
            this.CMD_MCU,
            0x00,
        ]);

        // read response from device
        const [ command, mcuByte ] = await this.readFromSerialPort();
        return mcuByte;

    }

    async getBoard() {

        await this.sendKissCommand([
            this.CMD_BOARD,
            0x00,
        ]);

        // read response from device
        const [ command, boardByte ] = await this.readFromSerialPort();
        return boardByte;

    }

    async getDeviceHash() {

        await this.sendKissCommand([
            this.CMD_DEV_HASH,
            0x01, // anything != 0x00
        ]);

        // read response from device
        const [ command, ...deviceHash ] = await this.readFromSerialPort();
        return deviceHash;

    }

    async getTargetFirmwareHash() {

        await this.sendKissCommand([
            this.CMD_HASHES,
            this.HASH_TYPE_TARGET_FIRMWARE,
        ]);

        // read response from device
        const [ command, hashType, ...targetFirmwareHash ] = await this.readFromSerialPort();
        return targetFirmwareHash;

    }

    async getFirmwareHash() {

        await this.sendKissCommand([
            this.CMD_HASHES,
            this.HASH_TYPE_FIRMWARE,
        ]);

        // read response from device
        const [ command, hashType, ...firmwareHash ] = await this.readFromSerialPort();
        return firmwareHash;

    }

    async getRom() {

        await this.sendKissCommand([
            this.CMD_ROM_READ,
            0x00,
        ]);

        // read response from device
        const [ command, ...eepromBytes ] = await this.readFromSerialPort();
        return eepromBytes;

    }

    async getFrequency() {

        await this.sendKissCommand([
            this.CMD_FREQUENCY,
            // request frequency by sending zero as 4 bytes
            0x00,
            0x00,
            0x00,
            0x00,
        ]);

        // read response from device
        const [ command, ...frequencyBytes ] = await this.readFromSerialPort();

        // convert 4 bytes to 32bit integer representing frequency in hertz
        const frequencyInHz = frequencyBytes[0] << 24 | frequencyBytes[1] << 16 | frequencyBytes[2] << 8 | frequencyBytes[3];
        return frequencyInHz;

    }

    async getBandwidth() {

        await this.sendKissCommand([
            this.CMD_BANDWIDTH,
            // request bandwidth by sending zero as 4 bytes
            0x00,
            0x00,
            0x00,
            0x00,
        ]);

        // read response from device
        const [ command, ...bandwidthBytes ] = await this.readFromSerialPort();

        // convert 4 bytes to 32bit integer representing bandwidth in hertz
        const bandwidthInHz = bandwidthBytes[0] << 24 | bandwidthBytes[1] << 16 | bandwidthBytes[2] << 8 | bandwidthBytes[3];
        return bandwidthInHz;

    }

    async getTxPower() {

        await this.sendKissCommand([
            this.CMD_TXPOWER,
            0xFF, // request tx power
        ]);

        // read response from device
        const [ command, txPower ] = await this.readFromSerialPort();

        return txPower;

    }

    async getSpreadingFactor() {

        await this.sendKissCommand([
            this.CMD_SF,
            0xFF, // request spreading factor
        ]);

        // read response from device
        const [ command, spreadingFactor ] = await this.readFromSerialPort();

        return spreadingFactor;

    }

    async getCodingRate() {

        await this.sendKissCommand([
            this.CMD_CR,
            0xFF, // request coding rate
        ]);

        // read response from device
        const [ command, codingRate ] = await this.readFromSerialPort();

        return codingRate;

    }

    async getRadioState() {

        await this.sendKissCommand([
            this.CMD_RADIO_STATE,
            0xFF, // request radio state
        ]);

        // read response from device
        const [ command, radioState ] = await this.readFromSerialPort();

        return radioState;

    }

    async getRxStat() {

        await this.sendKissCommand([
            this.CMD_STAT_RX,
            0x00,
        ]);

        // read response from device
        const [ command, ...statBytes ] = await this.readFromSerialPort();

        // convert 4 bytes to 32bit integer
        const stat = statBytes[0] << 24 | statBytes[1] << 16 | statBytes[2] << 8 | statBytes[3];
        return stat;

    }

    async getTxStat() {

        await this.sendKissCommand([
            this.CMD_STAT_TX,
            0x00,
        ]);

        // read response from device
        const [ command, ...statBytes ] = await this.readFromSerialPort();

        // convert 4 bytes to 32bit integer
        const stat = statBytes[0] << 24 | statBytes[1] << 16 | statBytes[2] << 8 | statBytes[3];
        return stat;

    }

    async getRssiStat() {

        await this.sendKissCommand([
            this.CMD_STAT_RSSI,
            0x00,
        ]);

        // read response from device
        const [ command, rssi ] = await this.readFromSerialPort();

        return rssi;

    }

    async disableBluetooth() {
        await this.sendKissCommand([
            this.CMD_BT_CTRL,
            0x00, // stop
        ]);
    }

    async enableBluetooth() {
        await this.sendKissCommand([
            this.CMD_BT_CTRL,
            0x01, // start
        ]);
    }

    async startBluetoothPairing() {
        await this.sendKissCommand([
            this.CMD_BT_CTRL,
            0x02, // enable pairing
        ]);
    }

    // setTNCMode
    async saveConfig() {
        await this.sendKissCommand([
            this.CMD_CONF_SAVE,
            0x00,
        ]);
    }

    // setNormalMode
    async deleteConfig() {
        await this.sendKissCommand([
            this.CMD_CONF_DELETE,
            0x00,
        ]);
    }

}