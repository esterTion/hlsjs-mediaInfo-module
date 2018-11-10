/*
 * @author esterTion
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

/* global Hls */

import MP4Parser from './mp4-parser.js';
import AVLTree from 'avl';

const HlsjsMediaInfoModuleProgressPercentageEvent = 'hlsMIStatPercentage';

class HlsjsMediaInfoModule {
    static observeMediaInfo(instance) {
        if (instance.hlsjsMediaInfoObserved) return;
        Object.defineProperty(instance, 'hlsjsMediaInfoObserved', {
            value: true,
            configurable: false,
            writable: false
        });

        let oldDestroy = instance.destroy;
        instance.destroy = function () {
            clearInterval(interval);
            oldDestroy.call(instance, arguments);
        };

        // downlaod stats
        let prevBytes = 0, isLoading = false, loadingFrag = null;
        function loadStart(n, d) {
            isLoading = true;
            loadingFrag = d.frag;
            instance.downloadPercentage = 0;
            instance.trigger(HlsjsMediaInfoModuleProgressPercentageEvent, 0);
        }
        function loadProgress(n, d) {
            let perc = d.stats.loaded / d.stats.total;
            instance.downloadPercentage = perc;
            instance.trigger(HlsjsMediaInfoModuleProgressPercentageEvent, perc);
        }
        function loadEnd(n, d) {
            isLoading = false;
            loadingFrag = null;
            prevBytes += d.stats.loaded;
            instance.downloadPercentage = 0;
            instance.trigger(HlsjsMediaInfoModuleProgressPercentageEvent, 0);
        }

        let pending = [];
        let levels = {};
        let currentLevel;
        function levelSwitching(n, d) {
            currentLevel = d.level;
            levels[currentLevel] = levels[currentLevel] || {
                level: currentLevel,
                bitrateMap: [],
                video: {
                    timeScale: 0,
                    samples: new AVLTree(),
                    bitrateMap: [],
                    totalDuration: 0,
                    totalSize: 0,
                    averageBitrate: 0
                },
                audio: {
                    timeScale: 0,
                    samples: new AVLTree(),
                    bitrateMap: [],
                    totalDuration: 0,
                    totalSize: 0,
                    averageBitrate: 0
                }
            };
            levels.current = levels[currentLevel];
        }
        function levelSwitched(n, d) {
            instance.mediaInfo = levels[d.level];
        }
        function appending(n, d) {
            d.level = currentLevel;
            pending.push(d);
        }
        let interval;

        interval = setInterval(function () {
            // download speed
            let loadedBytes = prevBytes;
            prevBytes = 0;
            if (isLoading) {
                loadedBytes += loadingFrag.loaded;
                prevBytes = -loadingFrag.loaded;
            }
            instance.downloadSpeed = loadedBytes / 1024;

            // mediaInfo
            let workRanges = [];
            while (pending.length) {
                let data = pending.shift();
                let type = data.type;
                let buffer = data.data;
                let offset = 0;
                let levelData = levels[data.level][type];
                if (!levelData) continue;
                while (offset < buffer.length) {
                    let box = MP4Parser.boxInfo(buffer, offset);
                    if (box.name == 'moov' || box.name == 'moof') {
                        let moovData = {};
                        MP4Parser.parseMoov(moovData, buffer, 0, box.size);
                        if (box.name == 'moof') {
                            let samples = levelData.samples;
                            let traf = moovData.moof[0].traf[0];
                            let ts = traf.tfdt.baseMediaDecodeTime;
                            let workRange = [type, Math.floor(ts / levelData.timeScale)];
                            for (let i = 0; i < traf.trun.sampleCount; i++) {
                                if (!samples.contains(ts)) {
                                    samples.insert(ts, traf.trun.sizes[i]);
                                    levelData.totalDuration += traf.trun.durations[i];
                                    levelData.totalSize += traf.trun.sizes[i];
                                }
                                i < traf.trun.sampleCount - 1 && (ts += traf.trun.durations[i]);
                            }
                            levelData.averageBitrate = levelData.totalSize * levelData.timeScale / levelData.totalDuration * 8;
                            workRange.push(Math.ceil(ts / levelData.timeScale));
                            workRange.push(data.level);
                            workRanges.push(workRange);

                            let bitrateHold = [];
                            samples.range(
                                workRange[1] * levelData.timeScale,
                                workRange[2] * levelData.timeScale,
                                function (node) {
                                    let ts = Math.floor(node.key / levelData.timeScale);
                                    bitrateHold[ts] = bitrateHold[ts] || 0;
                                    bitrateHold[ts] += node.data;
                                }
                            );
                            for (let i = workRange[1]; i < workRange[2]; i++) {
                                levelData.bitrateMap[i] = bitrateHold[i];
                            }
                        } else if (box.name == 'moov') {
                            levelData.timeScale = moovData.moov[0].mvhd.timeScale;
                            if (type == 'video') {
                                let sps = moovData.moov[0].trak[0].mdia[0].minf[0].stbl[0].stsd[0].avc1.extensions.avcC.SPS[0];
                                levelData.videoCodec = sps.codecString;
                                levelData.width = sps.present_size.width;
                                levelData.height = sps.present_size.height;
                                levelData.fps = sps.frame_rate.fps;
                                levelData.profile = sps.profile_string;
                                levelData.level = sps.level_string;
                                levelData.chromaFormat = sps.chroma_format_string;
                                levelData.sarNum = sps.sar_ratio.width;
                                levelData.sarDen = sps.sar_ratio.height;
                            } else if (type == 'audio') {
                                let specDesc = moovData.moov[0].trak[0].mdia[0].minf[0].stbl[0].stsd[0].mp4a.extensions.esds.esDescription.decConfigDescription.decSpecificDescription;
                                levelData.audioCodec = 'mp4a.40.' + specDesc.originalAudioObjectType;
                                levelData.audioSampleRate = [
                                    96000, 88200, 64000, 48000, 44100, 32000,
                                    24000, 22050, 16000, 12000, 11025, 8000, 7350
                                ][specDesc.samplingIndex];
                                levelData.audioChannelCount = specDesc.channelConfig;
                            }
                        }
                    }
                    offset += box.size;
                }
            }
            workRanges.forEach(function (workRange) {
                for (let i = workRange[1]; i < workRange[2]; i++) {
                    levels[workRange[3]].bitrateMap[i] = (
                        (levels[workRange[3]].video.bitrateMap[i] || 0) +
                        (levels[workRange[3]].audio.bitrateMap[i] || 0)
                    ) * 8 / 1000;
                }
            });
        }, 1000);

        instance.on(Hls.Events.FRAG_LOADING, loadStart);
        instance.on(Hls.Events.FRAG_LOAD_PROGRESS, loadProgress);
        instance.on(Hls.Events.FRAG_LOADED, loadEnd);
        instance.on(Hls.Events.BUFFER_APPENDING, appending);
        instance.on(Hls.Events.LEVEL_SWITCHING, levelSwitching);
        instance.on(Hls.Events.LEVEL_SWITCHED, levelSwitched);
        instance.mediaInfoLevels = levels;
    }
}

export default HlsjsMediaInfoModule;