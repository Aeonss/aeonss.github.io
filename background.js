const canvas = document.getElementById('network');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const numDots = 100;
const dots = [];

function Dot(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.velocity = {
        x: (Math.random() - 0.5) * 1,  // Reduced velocity
        y: (Math.random() - 0.5) * 1   // Reduced velocity
    };
}

Dot.prototype.draw = function () {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
}

Dot.prototype.update = function () {
    this.x += this.velocity.x;
    this.y += this.velocity.y;

    if (this.x + this.radius > canvas.width || this.x - this.radius < 0) {
        this.velocity.x = -this.velocity.x;
    }

    if (this.y + this.radius > canvas.height || this.y - this.radius < 0) {
        this.velocity.y = -this.velocity.y;
    }

    this.draw();
}

for (let i = 0; i < numDots; i++) {
    const radius = Math.random() * 3 + 1;
    const x = Math.random() * (canvas.width - radius * 2) + radius;
    const y = Math.random() * (canvas.height - radius * 2) + radius;
    dots.push(new Dot(x, y, radius));
}

function connectDots() {
    for (let i = 0; i < dots.length; i++) {
        for (let j = i; j < dots.length; j++) {
            const dx = dots[i].x - dots[j].x;
            const dy = dots[i].y - dots[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 80) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(dots[i].x, dots[i].y);
                ctx.lineTo(dots[j].x, dots[j].y);
                ctx.stroke();
            }
        }
    }
}

function areAllDotsConnected() {
    for (let i = 0; i < dots.length; i++) {
        for (let j = 0; j < dots.length; j++) {
            if (i !== j) {
                const dx = dots[i].x - dots[j].x;
                const dy = dots[i].y - dots[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance >= 80) {
                    return false;
                }
            }
        }
    }
    return true;
}

let allConnected = false;

function animate() {
    requestAnimationFrame(animate);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    dots.forEach(dot => {
        dot.update();
    });

    connectDots();

    if (areAllDotsConnected()) {
        allConnected = true;
        titleElement.textContent = "You did it!!";
    }
}

canvas.addEventListener('mousemove', (event) => {
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    dots.forEach(dot => {
        const dx = mouseX - dot.x;
        const dy = mouseY - dot.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 100) {
            dot.velocity.x = dx / 100;
            dot.velocity.y = dy / 100;
        }
    });
});

// Typing effect for the title
const titleElement = document.querySelector('.title');
const titleText = "Hello there...";
let i = 0;
let isTyping = true;

function animateTitle() {
    if (isTyping) {
        titleElement.textContent = titleText.slice(0, i);
        i++;
        if (i > titleText.length) {
            isTyping = false;
            i = titleText.length;
            setTimeout(animateTitle, 1000); // Wait for a few seconds before untyping
        } else {
            setTimeout(animateTitle, 100); // Adjust typing speed by changing the timeout
        }
    } else {
        titleElement.textContent = titleText.slice(0, i);
        i--;
        if (i < 0) {
            isTyping = true;
            i = 0;
            setTimeout(animateTitle, 1000); // Wait for a few seconds before typing
        } else {
            setTimeout(animateTitle, 100); // Adjust untyping speed by changing the timeout
        }
    }
}

animate();
animateTitle();