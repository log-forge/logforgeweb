(function () {
    const liveLogLines = [
        { source: "api-gateway", text: "GET /health 200 latency=18ms", hot: false },
        { source: "edge-agent-01", text: "forwarded docker log frame host=edge-a", hot: false },
        { source: "worker-02", text: "java.lang.OutOfMemoryError: Java heap space", hot: true },
        { source: "logforge", text: "template matched: logs.oom_guard", hot: true },
        { source: "alert-engine", text: "threshold 3/60s reached for worker-02", hot: true },
        { source: "notifier", text: "sent slack, gotify, webhook event=oom_guard", hot: false },
        { source: "gatekeeper", text: "cooldown ok; backoff window clear", hot: false },
        { source: "remediator", text: "docker restart worker-02 completed exit=0", hot: false },
        { source: "history", text: "outcome recorded incident=lf_7f91", hot: false }
    ];

    const flowSteps = [
        {
            label: "// ingest.collect",
            title: "Docker logs enter LogForge.",
            copy: "Tail local Docker containers out of the box, or receive forwarded logs from enrolled edge agents into a central LogForge host.",
            code: "source: docker://worker-02\npath: local tail or edge agent\nstate: collected\nnext: agent.forward"
        },
        {
            label: "// agent.forward",
            title: "Edge agent forwards logs to central.",
            copy: "Trusted edge agents send logs and Docker events to central LogForge, avoiding slow remote tailing loops.",
            code: "agent: edge-agent-01\ntarget: central.logforge\npayload: logs + docker events\nnext: template.match"
        },
        {
            label: "// template.match",
            title: "Rule template matches OOM or restart loop.",
            copy: "Start with templates for OutOfMemoryError, restart loops, crash loops, failed starts, floods, and database connection issues.",
            code: "template: logs.oom_guard\nmatch: /OutOfMemoryError|restart loop/\nscope: container=worker-02\nnext: alert.evaluate"
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

        let cursor = 0;

        function addLine() {
            const entry = liveLogLines[cursor % liveLogLines.length];
            const item = document.createElement("li");
            const time = document.createElement("time");
            const message = document.createElement("span");

            time.textContent = getClock();
            message.textContent = `${entry.source}: ${entry.text}`;

            if (entry.hot) {
                message.classList.add("log-hot");
            }

            item.append(time, message);
            stream.appendChild(item);

            while (stream.children.length > 7) {
                stream.removeChild(stream.firstElementChild);
            }

            cursor += 1;
        }

        for (let index = 0; index < 7; index += 1) {
            addLine();
        }

        window.setInterval(addLine, 1800);
    }

    function setupFlow() {
        const nodes = Array.from(document.querySelectorAll("[data-flow-step]"));
        const label = document.getElementById("flow-step-label");
        const title = document.getElementById("flow-step-title");
        const copy = document.getElementById("flow-step-copy");
        const code = document.getElementById("flow-step-code");

        if (!nodes.length || !label || !title || !copy || !code) {
            return;
        }

        let activeIndex = 0;
        let timer = null;

        function renderStep(index) {
            const step = flowSteps[index];
            activeIndex = index;

            nodes.forEach(function (node) {
                const isActive = Number(node.dataset.flowStep) === index;
                node.classList.toggle("is-active", isActive);
                node.setAttribute("aria-pressed", String(isActive));
            });

            label.textContent = step.label;
            title.textContent = step.title;
            copy.textContent = step.copy;
            code.textContent = step.code;
        }

        function startTimer() {
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                return;
            }

            window.clearInterval(timer);
            timer = window.setInterval(function () {
                renderStep((activeIndex + 1) % flowSteps.length);
            }, 4200);
        }

        nodes.forEach(function (node) {
            node.addEventListener("click", function () {
                renderStep(Number(node.dataset.flowStep));
                startTimer();
            });
        });

        renderStep(0);
        startTimer();
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
