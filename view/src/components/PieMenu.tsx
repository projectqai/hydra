import { createSignal, createEffect, For, onCleanup, createMemo } from 'solid-js';
// import { TaskableOption } from '../proto/world_pb'; // TaskableOption no longer exists
import './PieMenu.css';

export interface PieMenuProps {
  x: number;
  y: number;
  visible: boolean;
  taskables?: any[]; // TaskableOption removed from proto
  onActionClick: (taskable: any) => void;
  onTestClick: () => void;
  onClose: () => void;
}

export function PieMenu(props: PieMenuProps) {
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  
  // Always include "test" item plus taskables
  const allItems = createMemo(() => {
    const testItem = { actionLabel: 'test', description: 'Test action', controller: '', relativeID: '', taskedEntityID: [] };
    const taskables = props.taskables || [];
    return [testItem, ...taskables];
  });
  
  // Close on outside click
  createEffect(() => {
    if (props.visible) {
      const handleOutsideClick = (e: MouseEvent) => {
        const container = containerRef();
        if (container && !container.contains(e.target as Node)) {
          props.onClose();
        }
      };
      
      // Add listener after a short delay to prevent immediate closing
      setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
      }, 50);
      
      onCleanup(() => {
        document.removeEventListener('click', handleOutsideClick);
      });
    }
  });

  const handleSliceClick = (item: any, e: MouseEvent) => {
    e.stopPropagation();
    if (item.actionLabel === 'test') {
      props.onTestClick();
    } else {
      props.onActionClick(item);
    }
    props.onClose();
  };

  const radius = 80;

  return (
    <div
      ref={setContainerRef}
      class={`pie-menu ${props.visible ? 'visible' : ''}`}
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
      }}
    >
      <svg 
        class="pie-menu-svg"
        width={radius * 2}
        height={radius * 2}
        viewBox={`0 0 ${radius * 2} ${radius * 2}`}
      >
        <For each={allItems()}>
          {(item, index) => {
            const totalSlices = allItems().length;
            
            // For single item, draw a full circle using a different approach
            let pathData: string;
            if (totalSlices === 1) {
              pathData = `M ${radius} ${radius * 0.1} A ${radius * 0.9} ${radius * 0.9} 0 1 1 ${radius} ${radius * 0.1 + 0.01} Z`;
            } else {
              const angleStep = (2 * Math.PI) / totalSlices;
              const startAngle = index() * angleStep - Math.PI / 2;
              const endAngle = (index() + 1) * angleStep - Math.PI / 2;
              
              const startX = radius + Math.cos(startAngle) * radius;
              const startY = radius + Math.sin(startAngle) * radius;
              const endX = radius + Math.cos(endAngle) * radius;
              const endY = radius + Math.sin(endAngle) * radius;
              
              const largeArcFlag = angleStep >= Math.PI ? 1 : 0;
              
              pathData = [
                `M ${radius} ${radius}`,
                `L ${startX} ${startY}`,
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
                'Z'
              ].join(' ');
            }
            
            // Calculate text position
            let textX: number, textY: number;
            if (totalSlices === 1) {
              // Center text for full circle
              textX = radius;
              textY = radius;
            } else {
              const angleStep = (2 * Math.PI) / totalSlices;
              const startAngle = index() * angleStep - Math.PI / 2;
              const textAngle = startAngle + angleStep / 2;
              const textRadius = radius * 0.65;
              textX = radius + Math.cos(textAngle) * textRadius;
              textY = radius + Math.sin(textAngle) * textRadius;
            }
            
            return (
              <g 
                class="pie-slice"
                onClick={(e) => handleSliceClick(item, e)}
              >
                <path
                  d={pathData}
                  class="pie-slice-path"
                />
                <text
                  x={textX}
                  y={textY}
                  class="pie-slice-text"
                  text-anchor="middle"
                  dominant-baseline="middle"
                >
                  {item.actionLabel}
                </text>
              </g>
            );
          }}
        </For>
      </svg>
      <div class="pie-menu-center"></div>
    </div>
  );
}