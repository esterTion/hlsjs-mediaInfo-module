/*
 * @author esterTion <esterTionCN@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import SPSParser from './sps-parser.js';

function ReadBig16(array, index) {
    return ((array[index] << 8) |
        (array[index + 1]));
}
function ReadBig32(array, index) {
    return ReadBig16(array, index) * 65536 + ReadBig16(array, index + 2);
}
function ReadBig64(array, index) {
    return ReadBig32(array, index) * 4294967296 + ReadBig32(array, index + 4);
}
function ReadString(uintarray, index, length) {
    let arr = [];
    for (let i = 0; i < length; i++) {
        arr.push(uintarray[index + i]);
    }
    try {
        return decodeURIComponent(escape(String.fromCharCode.apply(null, arr)));
    } catch (e) {
        return '';
    }
}
const esdsIDs = {
    3: 'esDescription',
    4: 'decConfigDescription',
    5: 'decSpecificDescription'
};
function esdsParse(parent, array, index) {
    let descType = array[index];
    let offset = 1;
    let size = 0;
    let byteRead = array[index + offset];
    while (byteRead & 0x80) {
        size = (byteRead & 0x7f) << 7;
        offset++;
        byteRead = array[index + offset];
    }
    size += byteRead & 0x7f;
    offset++;
    switch (descType) {
        case 3: {
            //esDesc
            let trackID = ReadBig16(array, index + offset);
            let flags = array[index + offset + 2];
            offset += 3;
            parent[esdsIDs[descType]] = {
                size,
                trackID
            };
            esdsParse(parent[esdsIDs[descType]], array, index + offset);
            break;
        }
        case 4: {
            //decConfig
            let oti = array[index + offset];
            let streamType = array[index + offset + 1];
            let bufferSize = ReadBig32(array, index + offset + 1) & 0xffffff;
            let maxBitrate = ReadBig32(array, index + offset + 5);
            let avgBitrate = ReadBig32(array, index + offset + 9);
            parent[esdsIDs[descType]] = {
                oti,
                streamType,
                bufferSize,
                maxBitrate,
                avgBitrate,
            };
            esdsParse(parent[esdsIDs[descType]], array, index + offset + 13);
            break;
        }
        case 5: {
            //decSpecfic
            let data = Array.from(new Uint8Array(array.buffer, array.byteOffset + index + offset, size));
            let originalAudioObjectType = data[0] >>> 3;
            let samplingIndex = ((data[0] & 0x07) << 1) | (data[1] >>> 7);
            let channelConfig = (data[1] & 0x78) >>> 3;
            parent[esdsIDs[descType]] = {
                data,
                originalAudioObjectType,
                samplingIndex,
                channelConfig
            };
            break;
        }
    }
}

const containerBox = [
    'moov',
    'trak',
    'mdia',
    'minf',
    'stbl',
    'moof',
    'traf'
];
class MP4Parser {
    static boxInfo(uintarr, index) {
        let boxSize = ReadBig32(uintarr, index);
        let boxName = ReadString(uintarr, index + 4, 4);
        let boxHeadSize = 8;
        if (boxSize == 1) {
            boxSize = ReadBig64(uintarr, index + 8);
            boxHeadSize = 16;
        }
        let fullyLoaded = uintarr.length >= (index + boxSize);
        if (boxSize == 0)
            return {
                size: 8,
                headSize: boxHeadSize,
                name: '',
                fullyLoaded: true
            };
        return {
            size: boxSize,
            headSize: boxHeadSize,
            name: boxName,
            fullyLoaded: fullyLoaded
        };
    }
    static parseMoov(parent, data, index, length) {
        let offset = 0;
        while (offset < length) {
            let box = MP4Parser.boxInfo(data, index + offset);
            if (containerBox.indexOf(box.name) !== -1) {
                parent[box.name] = parent[box.name] || [];
                parent[box.name].push({});
                MP4Parser.parseMoov(parent[box.name][parent[box.name].length - 1], data, index + offset + 8, box.size - 8);
            } else {
                let body;
                switch (box.name) {
                    case 'mvhd': {
                        /*
                        mvhd struct
                        version 1   0
                        flags   3   1
                        create  4   4
                        modifi  4   8
                        Tscale  4   12
                        dura    4   16
                        rate    4   20
                        volume  2   24
                        reserve 10  26
                        matrik  36  36
                        preT    4   72
                        preD    4   76
                        poster  4   80
                        selectT 4   84
                        selectD 4   88
                        current 4   92
                        nextID  4   96
                        */
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let version = body[0];
                        let timeScale = ReadBig32(body, version == 1 ? 20 : 12);
                        let duration = version == 1 ? ReadBig64(body, 24) : ReadBig32(body, 16);
                        parent[box.name] = {
                            version,
                            timeScale,
                            duration
                        };
                        break;
                    }
                    case 'tkhd': {
                        /*
                        tkhd struct
                        version 1   0
                        flags   3   1
                        create  4   4
                        modifi  4   8
                        trackID 4   12
                        reserve 4   16
                        dura    4   20
                        reserve 8   24
                        layer   2   32
                        group   2   34
                        volume  2   36
                        reserve 2   38
                        matrix  36  40
                        Twidth  4   76
                        Theight 4   80
                        */
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let flags = {
                            trackEnbaled: body[3] & 1,
                            trackInMovie: (body[3] & 2) >> 1,
                            trackInPreview: (body[3] & 4) >> 2,
                            trackInPoster: (body[3] & 8) >> 3
                        };
                        let trackID = ReadBig32(body, 12);
                        let duration = ReadBig32(body, 20);
                        let group = ReadBig16(body, 34);
                        let trackWidth = parseFloat(ReadBig16(body, 72) + '.' + ReadBig16(body, 74));
                        let trackHeight = parseFloat(ReadBig16(body, 76) + '.' + ReadBig16(body, 78));

                        parent[box.name] = {
                            flags,
                            trackID,
                            duration,
                            group,
                            trackWidth,
                            trackHeight
                        };
                        break;
                    }
                    case 'mdhd': {
                        /*
                        mdhd struct
                        version 1   0
                        flags   3   1
                        create  4   4
                        modifi  4   8
                        Tscale  4   12
                        dura    4   16
                        lang    2   20
                        quality 2   22
                        */
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let version = body[0];
                        let boxOffset = version == 1 ? 24 : 16;
                        let duration = (version == 1 ? ReadBig64 : ReadBig32)(body, boxOffset);
                        boxOffset += version == 1 ? 8 : 4;
                        let language = ReadBig16(body, boxOffset);

                        parent[box.name] = {
                            version,
                            duration,
                            language
                        };
                        break;
                    }
                    case 'stsd': {
                        parent[box.name] = parent[box.name] || [];
                        parent[box.name].push({});
                        MP4Parser.parseMoov(parent[box.name][parent[box.name].length - 1], data, index + offset + 16, box.size - 16);
                        break;
                    }
                    case 'avc1': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let dataReferenceIndex = ReadBig32(body, 4);
                        let version = ReadBig16(body, 8);
                        let revisionLevel = ReadBig16(body, 10);
                        let vendor = ReadBig32(body, 12);
                        let temporalQuality = ReadBig32(body, 16);
                        let spatialQuality = ReadBig32(body, 20);
                        let width = ReadBig16(body, 24);
                        let height = ReadBig16(body, 26);
                        let horizontalResolution = parseFloat(ReadBig16(body, 28) + '.' + ReadBig16(body, 30));
                        let verticalResolution = parseFloat(ReadBig16(body, 32) + '.' + ReadBig16(body, 34));
                        let dataSize = ReadBig32(body, 36);
                        let frameCount = ReadBig16(body, 40);
                        let compressorName = ReadString(body, 42, 32);
                        let depth = ReadBig16(body, 74);
                        let colorTableID = ReadBig16(body, 76);

                        parent[box.name] = {
                            dataReferenceIndex,
                            version,
                            revisionLevel,
                            vendor,
                            temporalQuality,
                            spatialQuality,
                            width,
                            height,
                            horizontalResolution,
                            verticalResolution,
                            dataSize,
                            frameCount,
                            compressorName,
                            depth,
                            colorTableID,
                            extensions: {}
                        };
                        MP4Parser.parseMoov(parent[box.name].extensions, data, index + offset + 86, box.size - 86);
                        break;
                    }
                    case 'avcC': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let configurationVersion = body[0];
                        let avcProfileIndication = body[1];
                        let profile_compatibility = body[2];
                        let AVCLevelIndication = body[3];
                        let lengthSizeMinusOne = body[4] & 0x3;
                        let nb_nalus = body[5] & 0x1f;
                        let SPS = new Array(nb_nalus);
                        let recordLength;
                        let boxOffset = 6;
                        for (let i = 0; i < nb_nalus; i++) {
                            recordLength = ReadBig16(body, boxOffset);
                            boxOffset += 2;
                            SPS[i] = SPSParser.parseSPS(new Uint8Array(data.buffer, data.byteOffset + index + offset + 8 + boxOffset, recordLength));
                            let codecString = 'avc1.';
                            let codecArray = body.subarray(boxOffset + 1, boxOffset + 4);
                            for (let j = 0; j < 3; j++) {
                                let h = codecArray[j].toString(16);
                                if (h.length < 2) {
                                    h = '0' + h;
                                }
                                codecString += h;
                            }
                            SPS[i].codecString = codecString;
                            boxOffset += recordLength;
                        }
                        nb_nalus = body[boxOffset];
                        let PPS = new Array(nb_nalus);
                        boxOffset++;
                        for (let i = 0; i < nb_nalus; i++) {
                            recordLength = ReadBig16(body, offset);
                            boxOffset += 2;
                            //ignoring PPS
                            boxOffset += recordLength;
                        }
                        parent[box.name] = {
                            configurationVersion,
                            avcProfileIndication,
                            profile_compatibility,
                            AVCLevelIndication,
                            lengthSizeMinusOne,
                            SPS,
                            data: body
                        };
                        break;
                    }
                    case 'mp4a': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let dataReferenceIndex = ReadBig32(body, 4);
                        let version = ReadBig16(body, 8);
                        let revisionLevel = ReadBig16(body, 10);
                        let vendor = ReadBig32(body, 12);
                        let channels = ReadBig16(body, 16);
                        let sampleSize = ReadBig16(body, 18);
                        let compressionID = ReadBig16(body, 20);
                        let packetSize = ReadBig16(body, 22);
                        let sampleRate = ReadBig16(body, 24);
                        //unknown two bytes here???
                        parent[box.name] = {
                            dataReferenceIndex,
                            version,
                            revisionLevel,
                            vendor,
                            channels,
                            sampleSize,
                            compressionID,
                            packetSize,
                            sampleRate,
                            extensions: {}
                        };
                        MP4Parser.parseMoov(parent[box.name].extensions, data, index + offset + 36, box.size - 36);
                        break;
                    }
                    case 'esds': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let esdsData = {};
                        esdsParse(esdsData, body, 4);
                        parent[box.name] = esdsData;
                        break;
                    }
                    case 'stts': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let entryCount = ReadBig32(body, 0);
                        let sampleTable = [];
                        let boxOffset = 4;
                        for (let i = 0; i < entryCount; i++) {
                            let sampleCount = ReadBig32(body, boxOffset);
                            let sampleDuration = ReadBig32(body, boxOffset + 4);
                            sampleTable.push({
                                sampleCount, sampleDuration
                            });
                            boxOffset += 8;
                        }
                        parent[box.name] = sampleTable;
                        break;
                    }
                    case 'ctts': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let entryCount = ReadBig32(body, 0);
                        let sampleTable = [];
                        let boxOffset = 4;
                        for (let i = 0; i < entryCount; i++) {
                            let sampleCount = ReadBig32(body, boxOffset);
                            let compositionOffset = ReadBig32(body, boxOffset + 4);
                            sampleTable.push({
                                sampleCount, compositionOffset
                            });
                            boxOffset += 8;
                        }
                        parent[box.name] = sampleTable;
                        break;
                    }
                    case 'stss': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let entryCount = ReadBig32(body, 0);
                        let sampleTable = new Uint32Array(entryCount);
                        let boxOffset = 4;
                        for (let i = 0; i < entryCount; i++) {
                            sampleTable[i] = ReadBig32(body, boxOffset);
                            boxOffset += 4;
                        }
                        parent[box.name] = sampleTable;
                        break;
                    }
                    case 'stsc': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let entryCount = ReadBig32(body, 0);
                        let sampleTable = [];
                        let boxOffset = 4;
                        for (let i = 0; i < entryCount; i++) {
                            let firstChunk = ReadBig32(body, boxOffset);
                            let samplesPerChunk = ReadBig32(body, boxOffset + 4);
                            let sampleDescID = ReadBig32(body, boxOffset + 8);
                            sampleTable.push({
                                firstChunk, samplesPerChunk, sampleDescID
                            });
                            boxOffset += 12;
                        }
                        parent[box.name] = sampleTable;
                        break;
                    }
                    case 'stsz': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let sampleSize = ReadBig32(body, 0);
                        let entryCount = ReadBig32(body, 4);
                        let sampleTable = new Uint32Array(entryCount);
                        let boxOffset = 8;
                        for (let i = 0; i < entryCount; i++) {
                            sampleTable[i] = ReadBig32(body, boxOffset);
                            boxOffset += 4;
                        }
                        parent[box.name] = {
                            sampleSize,
                            sampleTable
                        };
                        break;
                    }
                    case 'stco': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let entryCount = ReadBig32(body, 0);
                        let sampleTable = new Uint32Array(entryCount);
                        let boxOffset = 4;
                        for (let i = 0; i < entryCount; i++) {
                            sampleTable[i] = ReadBig32(body, boxOffset);
                            boxOffset += 4;
                        }
                        parent[box.name] = sampleTable;
                        break;
                    }
                    case 'co64': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let entryCount = ReadBig32(body, 0);
                        let sampleTable = new Float64Array(entryCount);
                        let boxOffset = 4;
                        for (let i = 0; i < entryCount; i++) {
                            sampleTable[i] = ReadBig64(body, boxOffset);
                            boxOffset += 8;
                        }
                        parent['stco'] = sampleTable;
                        break;
                    }
                    case 'hdlr': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let handler = ReadString(body, 4, 4);
                        parent[box.name] = {
                            handler
                        };
                        break;
                    }
                    case 'tfdt': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 8, box.size - 8);
                        let version = body[0];
                        let baseMediaDecodeTime = (version == 1 ? ReadBig64 : ReadBig32)(body, 4);
                        parent['tfdt'] = {
                            baseMediaDecodeTime
                        };
                        break;
                    }
                    case 'trun': {
                        body = new Uint8Array(data.buffer, data.byteOffset + index + offset + 12, box.size - 12);
                        let sampleCount = ReadBig32(body, 0);
                        let durations = new Uint32Array(sampleCount);
                        let sizes = new Uint32Array(sampleCount);
                        let boxOffset = 8;
                        for (let i = 0; i < sampleCount; i++) {
                            durations[i] = ReadBig32(body, boxOffset);
                            sizes[i] = ReadBig32(body, boxOffset + 4);
                            boxOffset += 16;
                        }
                        parent['trun'] = {
                            sampleCount,
                            durations,
                            sizes
                        };
                        break;
                    }
                    default: {
                        //parent[box.name] = box;
                    }
                }
            }
            offset += box.size;
        }
    }
}


export default MP4Parser;