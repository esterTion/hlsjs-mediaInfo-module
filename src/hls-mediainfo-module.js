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

class HlsjsMediaInfoModule {
    observeMediaInfo(instance) {
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
        }
        function loadEnd(n, d) {
            isLoading = false;
            loadingFrag = null;
            prevBytes += d.stats.loaded;
        }

        let pending = [];
        let levels = {};
        let currentLevel;
        function levelSwitching(n, d) {
            currentLevel = d.level;
            levels[currentLevel] = levels[currentLevel] || {
                bitrateMap: [],
                video: {
                    timeScale: 0,
                    samples: new AVLTree(),
                    bitrateMap: []
                },
                audio: {
                    timeScale: 0,
                    samples: new AVLTree(),
                    bitrateMap: []
                }
            };
            levels.current = levels[currentLevel];
        }
        function levelSwitched(n, d) {
            //
        }
        function appending(n, d) {
            pending.push(d);
        }
        let interval;

        interval = setInterval(function () {
            //
        }, 1000);

        instance.on(Hls.Events.FRAG_LOADING, loadStart);
        instance.on(Hls.Events.FRAG_LOADED, loadEnd);
        instance.on(Hls.Events.BUFFER_APPENDING, appending);
        instance.on(Hls.Events.LEVEL_SWITCHING, levelSwitching);
        instance.on(Hls.Events.LEVEL_SWITCHED, levelSwitched);
    }
}

export default HlsjsMediaInfoModule;