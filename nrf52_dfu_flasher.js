/**
 * A web based nRF52 flasher based on:
 * https://github.com/adafruit/Adafruit_nRF52_nrfutil/blob/master/nordicsemi/dfu/dfu_transport_serial.py
 */
class Nrf52DfuFlasher {

    DFU_TOUCH_BAUD = 1200;
    SERIAL_PORT_OPEN_WAIT_TIME = 0.1;
    TOUCH_RESET_WAIT_TIME = 1.5;

    FLASH_BAUD = 115200;

    HexType_APPLICATION = 4;

    DFU_INIT_PACKET = 1;
    DFU_START_PACKET = 3;
    DFU_DATA_PACKET = 4;
    DFU_STOP_DATA_PACKET = 5;

    DATA_INTEGRITY_CHECK_PRESENT = 1;
    RELIABLE_PACKET = 1;
    HCI_PACKET_TYPE = 14;

    FLASH_PAGE_SIZE = 4096;
    FLASH_PAGE_ERASE_TIME = 0.0897;
    FLASH_WORD_WRITE_TIME = 0.000100;
    FLASH_PAGE_WRITE_TIME = (this.FLASH_PAGE_SIZE/4) * this.FLASH_WORD_WRITE_TIME;

    // The DFU packet max size
    DFU_PACKET_MAX_SIZE = 512;

    constructor(serialPort) {
        this.serialPort = serialPort;
        this.sequence_number = 0;
        this.sd_size = 0;
        this.total_size = 0;
    }

    async send_packet(data) {
        const writer = this.serialPort.writable.getWriter();
        try {
            console.log("writing", data);
            await writer.write(new Uint8Array(data));
        } finally {
            writer.releaseLock();
        }
    }

    /**
     * Puts an nRF52 board into DFU mode by quickly opening and closing a serial port
     * @returns {Promise<void>}
     */
    async enterDfuMode() {

        // open port
        await this.serialPort.open({
            baudRate: this.DFU_TOUCH_BAUD,
        });

        // wait SERIAL_PORT_OPEN_WAIT_TIME before closing port
        await new Promise((resolve, reject) => {
            setTimeout(resolve, this.SERIAL_PORT_OPEN_WAIT_TIME * 1000);
        });

        // close port
        await this.serialPort.close();

        // wait TOUCH_RESET_WAIT_TIME for device to enter into DFU mode
        await new Promise((resolve, reject) => {
            setTimeout(resolve, this.TOUCH_RESET_WAIT_TIME * 1000);
        });

    }

    async flash(firmwareZipBlob) {

        // read zip file
        const blobReader = new window.zip.BlobReader(firmwareZipBlob);
        const zipReader = new window.zip.ZipReader(blobReader);
        const zipEntries = await zipReader.getEntries();

        // find manifest file
        const manifestFile = zipEntries.find((zipEntry) => zipEntry.filename === "manifest.json");

        // read manifest file as text
        const text = await manifestFile.getData(new window.zip.TextWriter());

        // parse manifest json
        const json = JSON.parse(text);
        const manifest = json.manifest;

        console.log(manifest);

        // if self.manifest.softdevice_bootloader:
        // self._dfu_send_image(HexType.SD_BL, self.manifest.softdevice_bootloader)
        //
        // if self.manifest.softdevice:
        // self._dfu_send_image(HexType.SOFTDEVICE, self.manifest.softdevice)
        //
        // if self.manifest.bootloader:
        // self._dfu_send_image(HexType.BOOTLOADER, self.manifest.bootloader)

        // flash application image
        if(manifest.application){
            await this.dfuSendImage(this.HexType_APPLICATION, zipEntries, manifest.application);
        }

    }

    async dfuSendImage(program_mode, zipEntries, firmware_manifest) {

        if(!firmware_manifest){
            throw "firmware_manifest must be provided.";
        }

        // open port
        await this.serialPort.open({
            baudRate: this.FLASH_BAUD,
        });

        // wait SERIAL_PORT_OPEN_WAIT_TIME
        await new Promise((resolve, reject) => {
            setTimeout(resolve, this.SERIAL_PORT_OPEN_WAIT_TIME * 1000);
        });

        var softdevice_size = 0
        var bootloader_size = 0
        var application_size = 0

        // read bin file (firmware)
        const binFile = zipEntries.find((zipEntry) => zipEntry.filename === firmware_manifest.bin_file);
        const firmware = await binFile.getData(new window.zip.Uint8ArrayWriter());
        console.log(firmware);

        // read dat file (init packet)
        const datFile = zipEntries.find((zipEntry) => zipEntry.filename === firmware_manifest.dat_file);
        const init_packet = await datFile.getData(new window.zip.Uint8ArrayWriter());
        console.log(init_packet);

        // only support flashing application for now
        if(program_mode !== this.HexType_APPLICATION){
            throw "not implemented";
        }

        if(program_mode === this.HexType_APPLICATION){
            application_size = firmware.length;
            console.log("app size", application_size);
        }

        // todo test this works...
        console.log("Sending DFU start packet");
        await this.send_start_dfu(program_mode, softdevice_size, bootloader_size, application_size);

        console.log("Sending DFU init packet");
        await this.send_init_packet(init_packet);

        console.log("Sending firmware file")
        await this.send_firmware(firmware);

        // console.log("Sending validate firmware")
        // await this.send_validate_firmware();
        //
        // console.log("Sending activate firmware")
        // await this.send_activate_firmware();

        // close port
        console.log("Closing Port");
        await this.serialPort.close();

        // todo
        // sleep(self.dfu_transport.get_activate_wait_time())

        console.log("Done");

    }

    // confirmed working
    calcCrc16(binaryData, crc = 0xffff) {
        /**
         * Calculates CRC16 on binaryData
         *
         * @param {Uint8Array} binaryData - Array with data to run CRC16 calculation on
         * @param {number} crc - CRC value to start calculation with
         * @return {number} - Calculated CRC value of binaryData
         */
        if (!(binaryData instanceof Uint8Array)) {
            throw new Error("calcCrc16 requires Uint8Array input");
        }

        for (let b of binaryData) {
            crc = (crc >> 8 & 0x00FF) | (crc << 8 & 0xFF00);
            crc ^= b;
            crc ^= (crc & 0x00FF) >> 4;
            crc ^= (crc << 8) << 4;
            crc ^= ((crc & 0x00FF) << 4) << 1;
        }

        return crc & 0xFFFF;
    }

    // confirmed working
    slipEncodeEscChars(dataIn) {
        /**
         * Encode esc characters in a SLIP package.
         *
         * Replace 0xC0 with 0xDBDC and 0xDB with 0xDBDD.
         *
         * @param {string} dataIn - String to encode
         * @return {string} - String with encoded packet
         */
        let result = [];

        for (let i = 0; i < dataIn.length; i++) {
            let char = dataIn[i];
            if (char === 0xC0) {
                result.push(0xDB);
                result.push(0xDC);
            } else if (char === 0xDB) {
                result.push(0xDB);
                result.push(0xDD);
            } else {
                result.push(char);
            }
        }

        // return String.fromCharCode(...result);
        return result;

    }

    // seems to be working as expected, was hard to test
    frameToHciPacket(frame) {

        this.sequence_number = (this.sequence_number + 1) % 8;

        const slip_bytes = this.slipPartsToFourBytes(
            this.sequence_number,
            this.DATA_INTEGRITY_CHECK_PRESENT,
            this.RELIABLE_PACKET,
            this.HCI_PACKET_TYPE,
            frame.length,
        );

        let tempData = [
            ...slip_bytes,
            ...frame,
        ];

        // Add escape characters
        const crc = this.calcCrc16(new Uint8Array(tempData), 0xffff);
        tempData.push(crc & 0xFF)
        tempData.push((crc & 0xFF00) >> 8)

        return [
            0xc0,
            ...this.slipEncodeEscChars(tempData),
            0xc0,
        ];

    }

    get_erase_wait_time() {
        // timeout is not least than 0.5 seconds
        return Math.max(0.5, ((this.total_size / this.FLASH_PAGE_SIZE) + 1) * this.FLASH_PAGE_ERASE_TIME);
    }

    // frame seems to be fine
    async send_start_dfu(mode, softdevice_size = 0, bootloader_size = 0, app_size = 0){

        const frame = [
            ...this.toBytesInt32(this.DFU_START_PACKET),
            ...this.toBytesInt32(mode),
            ...this.create_image_size_packet(softdevice_size, bootloader_size, app_size),
        ];

        await this.send_packet(this.frameToHciPacket(frame));

        this.sd_size = softdevice_size;
        this.total_size = softdevice_size + bootloader_size + app_size;

        await new Promise((resolve, reject) => {
            setTimeout(resolve, this.get_erase_wait_time() * 1000);
        });

    }

    async send_init_packet(init_packet){

        const frame = [
            ...this.toBytesInt32(this.DFU_INIT_PACKET),
            ...init_packet,
            ...this.toBytesInt16(0x0000), // Padding required
        ];

        await this.send_packet(this.frameToHciPacket(frame));

    }

    async send_firmware(firmware) {

        const frames = [];

        // seems to be chunking properly
        for(let i = 0; i < firmware.length; i += this.DFU_PACKET_MAX_SIZE){
            frames.push(this.frameToHciPacket([
                ...this.toBytesInt32(this.DFU_DATA_PACKET),
                ...firmware.slice(i, i + this.DFU_PACKET_MAX_SIZE),
            ]));
        }

        // todo rename to packet?
        for(var i = 0; i < frames.length; i++){

            const frame = frames[i];

            await this.send_packet(frame);

            // wait a bit to allow device to write before sending next frame
            await new Promise((resolve, reject) => {
                setTimeout(resolve, this.FLASH_PAGE_WRITE_TIME * 1000);
            });

        }

        // Wait for last page to write
        await new Promise((resolve, reject) => {
            setTimeout(resolve, this.FLASH_PAGE_WRITE_TIME * 1000);
        });

        // Send data stop packet
        await this.send_packet(this.frameToHciPacket([
            ...this.toBytesInt32(this.DFU_STOP_DATA_PACKET),
        ]));

    }

    async send_validate_firmware() {
        // no op for usb
    }

    async send_activate_firmware() {
        // no op for usb
    }

    /**
     * Creates a SLIP header.
     *
     * For a description of the SLIP header go to:
     * http://developer.nordicsemi.com/nRF51_SDK/doc/7.2.0/s110/html/a00093.html
     *
     * @param {number} seq - Packet sequence number
     * @param {number} dip - Data integrity check
     * @param {number} rp - Reliable packet
     * @param {number} pktType - Payload packet
     * @param {number} pktLen - Packet length
     * @return {Uint8Array} - SLIP header
     */
    // confirmed working
    slipPartsToFourBytes(seq, dip, rp, pktType, pktLen) {
        let ints = [0, 0, 0, 0];
        ints[0] = seq | (((seq + 1) % 8) << 3) | (dip << 6) | (rp << 7);
        ints[1] = pktType | ((pktLen & 0x000F) << 4);
        ints[2] = (pktLen & 0x0FF0) >> 4;
        ints[3] = (~(ints[0] + ints[1] + ints[2]) + 1) & 0xFF;
        return new Uint8Array(ints);
    }

    // confirmed working
    create_image_size_packet(softdevice_size = 0, bootloader_size = 0, app_size = 0) {
        return [
            ...this.toBytesInt32(softdevice_size),
            ...this.toBytesInt32(bootloader_size),
            ...this.toBytesInt32(app_size),
        ];
    }

    // confirmed working
    toBytesInt32(num){
        return [
            (num & 0x000000ff),
            (num & 0x0000ff00) >> 8,
            (num & 0x00ff0000) >> 16,
            (num & 0xff000000) >> 24,
        ];
    }

    // confirmed working
    toBytesInt16(num){
        return [
            num & 0x00FF,
            (num & 0xFF00) >> 8,
        ];
    }

}
