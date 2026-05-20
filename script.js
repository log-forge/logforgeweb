(function () {
    const phrases = [
        { text: "Not logs", delay: 750 },
        { text: "Not analysis", delay: 750 },
        { text: "Just solutions.", delay: 1000 }
    ];

    function typePhrases(target) {
        let index = 0;

        function typeNextPhrase() {
            if (!target || index >= phrases.length) {
                return;
            }

            const phrase = phrases[index];
            let characterIndex = 0;
            target.textContent = "";

            const interval = window.setInterval(function () {
                target.textContent += phrase.text[characterIndex];
                characterIndex += 1;

                if (characterIndex === phrase.text.length) {
                    window.clearInterval(interval);
                    index += 1;
                    window.setTimeout(typeNextPhrase, phrase.delay);
                }
            }, 60);
        }

        typeNextPhrase();
    }

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
            const snippet = targetId ? document.getElementById(targetId) : null;
            const text = snippet ? snippet.textContent.trim() : "";

            if (!text) {
                return;
            }

            copyText(text).then(function () {
                button.classList.add("is-copied");
                window.setTimeout(function () {
                    button.classList.remove("is-copied");
                }, 2000);
            }).catch(function () {
                button.textContent = "Copy failed";
                window.setTimeout(function () {
                    button.innerHTML = '<span class="copy-default">Copy</span><span class="copy-success">Copied</span>';
                }, 2000);
            });
        });
    }

    function highlightPremiumSection() {
        if (window.location.hash !== "#premium") {
            return;
        }

        const premium = document.querySelector(".form-wrapper");
        if (!premium) {
            return;
        }

        window.setTimeout(function () {
            premium.scrollIntoView({ behavior: "smooth", block: "start" });
            premium.classList.add("is-highlighted");

            window.setTimeout(function () {
                premium.classList.remove("is-highlighted");
            }, 2200);
        }, 300);
    }

    window.addEventListener("DOMContentLoaded", function () {
        document.body.classList.add("is-ready");
        typePhrases(document.getElementById("animated-tagline"));
        setupCopyButton();
        highlightPremiumSection();
    });

    window.addEventListener("hashchange", highlightPremiumSection);
}());
