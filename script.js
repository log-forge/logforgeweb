(function () {
    const liveLogLines = [
        { source: "api-gateway", text: "GET /health 200 latency=18ms", hot: false },
        { source: "edge-agent-01", text: "forwarded docker log frame host=edge-a", hot: false },
        { source: "worker-02", text: "java.lang.OutOfMemoryError: Java heap space", hot: true },
        { source: "logforge", text: "rule matched: logs.oom_guard", hot: true },
        { source: "alert-engine", text: "threshold 3/60s reached for worker-02", hot: true },
        { source: "notifier", text: "sent slack, gotify, webhook event=oom_guard", hot: false },
        { source: "gatekeeper", text: "cooldown ok; backoff window clear", hot: false },
        { source: "remediator", text: "docker restart worker-02 completed exit=0", hot: false },
        { source: "history", text: "outcome recorded incident=lf_7f91", hot: false }
    ];

    const FLOW_ADVANCE_MS = 5500;
    const FLOW_TRANSITION_MS = 180;
    const MOBILE_LOG_ROW_LIMIT = 7;
    const DESKTOP_LOG_ROW_LIMIT = 12;
    const DESKTOP_LOG_MIN_WIDTH = 821;
    const LOG_TOP_GAP_LIMIT = 16;
    const LOG_GROWTH_TOLERANCE = 1;

    const flowSteps = [
        {
            label: "// ingest.paths",
            title: "Docker logs enter from hosts and agents.",
            copy: "Tail Docker logs by default on each host or enrolled agent, then forward logs and Docker events from agents into a central LogForge host.",
            code: "host: docker://worker-02 tail\nagent: edge-agent-01 tail + forward\nstate: ingested\nnext: rules.match"
        },
        {
            label: "// rules.match",
            title: "Rules match logs, rates, metrics, missing signals, or Docker events.",
            copy: "Start from Docker failure templates, then write custom rules for keywords or regex, event rates, missing heartbeat logs, metric thresholds, and container lifecycle events.",
            code: "rule: custom.checkout_errors\ntype: keyword\npattern: /payment failed|timeout/\nwindow: 5 events / 10m\nnext: alert.evaluate"
        },
        {
            label: "// alert.evaluate",
            title: "Alert engine evaluates threshold and timeline.",
            copy: "The engine checks event count, window, container state, and prior actions before declaring the incident actionable.",
            code: "window: 60s\nthreshold: 3 events\nobserved: 5 events\nstate: fired\nnext: notify.route"
        },
        {
            label: "// notify.route",
            title: "Notifier dispatches the signal.",
            copy: "Route to Slack, Discord, Telegram, Gotify, Teams, Pushover, SMS, email, or webhook from the same rule.",
            code: "channels: slack, gotify, webhook\npayload: container, rule, logs, action_plan\nstatus: delivered\nnext: gatekeeper.check"
        },
        {
            label: "// gatekeeper.check",
            title: "Gatekeeper applies cooldown and backoff.",
            copy: "Guard restart, stop, kill, start, and script actions so fixes are visible, bounded, and recorded.",
            code: "cooldown: clear\nbackoff: 1/3 attempts\naction: docker restart worker-02\nhistory: outcome recorded"
        }
    ];

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).catch(function () {
                return fallbackCopyText(text);
            });
        }

        return fallbackCopyText(text);
    }

    function fallbackCopyText(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();

        return new Promise(function (resolve, reject) {
            try {
                document.execCommand("copy");
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                document.body.removeChild(textArea);
            }
        });
    }

    function setupCopyButton() {
        const button = document.getElementById("copy-install");

        if (!button) {
            return;
        }

        button.addEventListener("click", function () {
            const targetId = button.getAttribute("data-copy-target");
            const target = targetId ? document.getElementById(targetId) : null;
            const text = target ? target.textContent.trim() : "";

            if (!text) {
                return;
            }

            copyText(text).then(function () {
                button.classList.add("is-copied");
                window.setTimeout(function () {
                    button.classList.remove("is-copied");
                }, 1800);
            }).catch(function () {
                const defaultLabel = button.querySelector(".copy-default");
                if (defaultLabel) {
                    defaultLabel.textContent = "Failed";
                    window.setTimeout(function () {
                        defaultLabel.textContent = "Copy";
                    }, 1800);
                }
            });
        });
    }

    function getClock() {
        return new Date().toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    function setupLiveLogs() {
        const stream = document.getElementById("hero-log-stream");

        if (!stream) {
            return;
        }

        const panel = stream.closest(".log-panel") || stream.parentElement;
        let cursor = 0;
        let entries = [];
        let rowTarget = MOBILE_LOG_ROW_LIMIT;
        let resizeFrame = null;

        function isDesktopLogLayout() {
            return window.innerWidth >= DESKTOP_LOG_MIN_WIDTH;
        }

        function createEntry() {
            const entry = liveLogLines[cursor % liveLogLines.length];
            cursor += 1;

            return {
                time: getClock(),
                source: entry.source,
                text: entry.text,
                hot: entry.hot
            };
        }

        function createLogItem(entry) {
            const item = document.createElement("li");
            const time = document.createElement("time");
            const message = document.createElement("span");

            time.textContent = entry.time;
            message.textContent = `${entry.source}: ${entry.text}`;

            if (entry.hot) {
                message.classList.add("log-hot");
            }

            item.append(time, message);
            return item;
        }

        function ensureEntries(count) {
            while (entries.length < count) {
                entries.push(createEntry());
            }
        }

        function pruneEntries() {
            while (entries.length > DESKTOP_LOG_ROW_LIMIT) {
                entries.shift();
            }
        }

        function renderRows(count) {
            const fragment = document.createDocumentFragment();
            const visibleEntries = entries.slice(-count);

            visibleEntries.forEach(function (entry) {
                fragment.appendChild(createLogItem(entry));
            });

            stream.replaceChildren(fragment);
        }

        function measureStream() {
            const streamRect = stream.getBoundingClientRect();
            const panelRect = panel ? panel.getBoundingClientRect() : streamRect;
            const firstItem = stream.firstElementChild;
            let topGap = Number.POSITIVE_INFINITY;

            if (firstItem) {
                const styles = window.getComputedStyle(stream);
                const paddingTop = parseFloat(styles.paddingTop) || 0;
                topGap = firstItem.getBoundingClientRect().top - streamRect.top - paddingTop;
            }

            return {
                panelHeight: panelRect.height,
                streamHeight: streamRect.height,
                topGap
            };
        }

        function hasGrown(candidate, baseline) {
            return candidate.panelHeight > baseline.panelHeight + LOG_GROWTH_TOLERANCE ||
                candidate.streamHeight > baseline.streamHeight + LOG_GROWTH_TOLERANCE;
        }

        function recomputeRowTarget() {
            if (!isDesktopLogLayout()) {
                rowTarget = MOBILE_LOG_ROW_LIMIT;
                renderRows(rowTarget);
                return;
            }

            ensureEntries(DESKTOP_LOG_ROW_LIMIT);

            let bestCount = MOBILE_LOG_ROW_LIMIT;
            renderRows(bestCount);

            const baseline = measureStream();

            if (baseline.topGap > LOG_TOP_GAP_LIMIT) {
                for (let count = MOBILE_LOG_ROW_LIMIT + 1; count <= DESKTOP_LOG_ROW_LIMIT; count += 1) {
                    renderRows(count);

                    const measurement = measureStream();

                    if (hasGrown(measurement, baseline)) {
                        break;
                    }

                    bestCount = count;

                    if (measurement.topGap <= LOG_TOP_GAP_LIMIT) {
                        break;
                    }
                }
            }

            rowTarget = bestCount;
            renderRows(rowTarget);
            pruneEntries();
        }

        function scheduleRowTargetRecompute() {
            if (resizeFrame) {
                window.cancelAnimationFrame(resizeFrame);
            }

            resizeFrame = window.requestAnimationFrame(function () {
                resizeFrame = null;
                recomputeRowTarget();
            });
        }

        function addLine() {
            entries.push(createEntry());
            pruneEntries();
            renderRows(isDesktopLogLayout() ? rowTarget : MOBILE_LOG_ROW_LIMIT);
            scheduleRowTargetRecompute();
        }

        for (let index = 0; index < MOBILE_LOG_ROW_LIMIT; index += 1) {
            addLine();
        }

        scheduleRowTargetRecompute();
        window.addEventListener("resize", scheduleRowTargetRecompute);

        window.setInterval(addLine, 1800);
    }

    function setupFlow() {
        const nodes = Array.from(document.querySelectorAll("[data-flow-step]"));
        const label = document.getElementById("flow-step-label");
        const title = document.getElementById("flow-step-title");
        const copy = document.getElementById("flow-step-copy");
        const code = document.getElementById("flow-step-code");
        const detail = document.querySelector(".flow-detail");

        if (!nodes.length || !label || !title || !copy || !code) {
            return;
        }

        const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        let activeIndex = 0;
        let timer = null;
        let transitionTimer = null;

        function allowMotion() {
            return !reducedMotionQuery.matches;
        }

        function renderStep(index, options) {
            const step = flowSteps[index];

            if (!step) {
                return;
            }

            const shouldTransition = Boolean(options && options.transition && detail && allowMotion());
            activeIndex = index;

            nodes.forEach(function (node) {
                const isActive = Number(node.dataset.flowStep) === index;
                node.classList.toggle("is-active", isActive);
                node.setAttribute("aria-pressed", String(isActive));
            });

            window.clearTimeout(transitionTimer);
            if (detail) {
                detail.classList.remove("is-transitioning");
            }

            label.textContent = step.label;
            title.textContent = step.title;
            copy.textContent = step.copy;
            code.textContent = step.code;

            if (shouldTransition) {
                detail.offsetWidth;
                detail.classList.add("is-transitioning");
                transitionTimer = window.setTimeout(function () {
                    detail.classList.remove("is-transitioning");
                }, FLOW_TRANSITION_MS);
            }
        }

        function startTimer() {
            window.clearInterval(timer);

            if (!allowMotion()) {
                return;
            }

            timer = window.setInterval(function () {
                renderStep((activeIndex + 1) % flowSteps.length, { transition: true });
            }, FLOW_ADVANCE_MS);
        }

        nodes.forEach(function (node) {
            node.addEventListener("click", function () {
                renderStep(Number(node.dataset.flowStep), { transition: true });
                startTimer();
            });
        });

        renderStep(0);
        startTimer();

        function handleMotionPreferenceChange() {
            if (allowMotion()) {
                startTimer();
                return;
            }

            window.clearInterval(timer);
            window.clearTimeout(transitionTimer);
            if (detail) {
                detail.classList.remove("is-transitioning");
            }
        }

        if (typeof reducedMotionQuery.addEventListener === "function") {
            reducedMotionQuery.addEventListener("change", handleMotionPreferenceChange);
        } else if (typeof reducedMotionQuery.addListener === "function") {
            reducedMotionQuery.addListener(handleMotionPreferenceChange);
        }
    }

    function setupTabs() {
        const tabRoots = Array.from(document.querySelectorAll("[data-tabs]"));

        tabRoots.forEach(function (root) {
            const buttons = Array.from(root.querySelectorAll("[data-tab]"));
            const panels = Array.from(root.querySelectorAll("[data-tab-panel]"));

            function activate(tabName) {
                buttons.forEach(function (button) {
                    const isActive = button.dataset.tab === tabName;
                    button.classList.toggle("is-active", isActive);
                    button.setAttribute("aria-selected", String(isActive));
                    button.tabIndex = isActive ? 0 : -1;
                });

                panels.forEach(function (panel) {
                    const isActive = panel.dataset.tabPanel === tabName;
                    panel.classList.toggle("is-active", isActive);
                    panel.hidden = !isActive;
                });
            }

            buttons.forEach(function (button, index) {
                button.addEventListener("click", function () {
                    activate(button.dataset.tab);
                });

                button.addEventListener("keydown", function (event) {
                    const movePrevious = event.key === "ArrowLeft" || event.key === "ArrowUp";
                    const moveNext = event.key === "ArrowRight" || event.key === "ArrowDown";

                    if (!movePrevious && !moveNext) {
                        return;
                    }

                    event.preventDefault();

                    const offset = moveNext ? 1 : -1;
                    const nextIndex = (index + offset + buttons.length) % buttons.length;
                    buttons[nextIndex].focus();
                    activate(buttons[nextIndex].dataset.tab);
                });
            });
        });
    }

    function setupPremiumWaitlist() {
        const form = document.getElementById("premium-form");
        const status = document.getElementById("premium-form-status");

        if (!form || !window.fetch || !window.FormData) {
            return;
        }

        const submit = form.querySelector("button[type='submit']");
        const defaultSubmitText = submit ? submit.textContent : "";

        form.addEventListener("submit", function (event) {
            event.preventDefault();

            if (submit) {
                submit.disabled = true;
                submit.textContent = "Sending...";
            }

            if (status) {
                status.classList.remove("is-error");
                status.textContent = "";
            }

            fetch(form.action, {
                method: "POST",
                mode: "no-cors",
                body: new FormData(form)
            }).then(function () {
                form.reset();

                if (status) {
                    status.textContent = "You're on the waitlist. We'll be in touch.";
                }
            }).catch(function () {
                if (status) {
                    status.classList.add("is-error");
                    status.textContent = "Could not submit. Open the Google Form link instead.";
                }
            }).finally(function () {
                if (submit) {
                    submit.disabled = false;
                    submit.textContent = defaultSubmitText;
                }
            });
        });
    }

    window.addEventListener("DOMContentLoaded", function () {
        setupCopyButton();
        setupLiveLogs();
        setupFlow();
        setupTabs();
        setupPremiumWaitlist();
    });
}());
