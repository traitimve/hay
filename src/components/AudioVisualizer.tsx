import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

export function AudioVisualizer({ analyser, isActive }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !analyser || !isActive) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    let animationId: number;

    const renderFrame = () => {
      animationId = requestAnimationFrame(renderFrame);
      analyser.getByteFrequencyData(dataArray);

      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      const barWidth = (WIDTH / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        const r = barHeight + (25 * (i / bufferLength));
        const g = 150 + (25 * (i / bufferLength));
        const b = 250;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        // Let's use a nice orange/red gradient based on our main theme
        ctx.fillStyle = `rgba(${255}, ${100 + (barHeight / 1.5)}, ${50}, ${0.8})`;

        // Draw centered vertically
        const y = (HEIGHT - barHeight) / 2;
        
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - 1, barHeight, 4);
        ctx.fill();

        x += barWidth;
      }
    };

    renderFrame();

    return () => {
      cancelAnimationFrame(animationId);
      // Clear canvas on unmount
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [analyser, isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={40}
      className={`w-48 h-8 opacity-80 ${isActive ? 'animate-in fade-in zoom-in duration-500' : 'opacity-0 transition-opacity duration-300'}`}
    />
  );
}
